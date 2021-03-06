"use strict";
var _ = require('lodash-contrib'),
    crypto = require('crypto'),
    Promise = require('mpromise'),
    inherits = require('util').inherits,
    StringField = require('../forms/fields').StringField,
    AdminForm = require('../forms/AdminForm');


var salt = 'wherestheninja';
function encryptSync(password) {
    if (!password) return password;
    return crypto.createHmac('sha1', salt).update(password).digest('hex');
}
function compareSync(raw, hashed) {
    var hashed_pass = encryptSync(raw);
    return (!hashed && !raw) || hashed == hashed_pass;
}


module.exports = function (mongoose) {
    var actions = ['view', 'delete', 'create', 'update', 'order'];

    var toName = function (modelName, action) {
        return modelName + '_' + action;
    };

    var schema = new mongoose.Schema({
        username: {type: String, required: true, unique: true},
        passwordHash: {type: String, editable: false},
        is_superuser: {type: Boolean, 'default': false},
        permissions: [
            { type: String, enum: [] }
        ],
        lastVisit: {type: Date, 'default': Date.now, editable: false}
    }, {strict: true});


    // **** Methods ****
    schema.methods.toSessionStore = function () {
        return this.toObject();
    };

    schema.methods.hasPermissions = function (modelName, action) {
        return this.is_superuser || ~this.permissions.indexOf(toName(modelName, action));
    };


    // **** Statics ****
    schema.statics.fromSessionStore = function (sessionStore) {
        return new this(sessionStore);
    };


    schema.registerModelPermissions = function (modelName, permissions) {
        if (!permissions) permissions = actions;
        permissions.forEach(function (permission) {
            schema.paths.permissions.caster.options.enum.push(toName(modelName, permission));
            schema.tree.permissions[0].enum = schema.paths.permissions.caster.options.enum;
        });
    };


    schema.statics.ensureExists = function (username, password, callback) {
        var vanilla = new this({username: username, passwordHash: encryptSync(password), is_superuser: true});
        if (!module.superUser) module.superUser = vanilla;
        this.findOne({'username': username}).exec().then(
            function (adminUserData) {
                if (!adminUserData) {
                    adminUserData = vanilla;
                }
                var d = Promise.deferred();
                adminUserData.save(d.callback);
                return d.promise;
            },
            function (err) { console.log(err); callback(null, vanilla); }
        ).then(
            function (admin_user) { callback(null, admin_user); }
        ).end();
    };


    schema.statics.getByUsernamePassword = function (username, password, callback) {
        if (username === module.superUser.username && compareSync(password, module.superUser.passwordHash)) {
            callback(module.superUser);
            return;
        }

        this.findOne({'username': username}, function (err, admin_user) {
            if (err) throw err;
            if (!admin_user) return callback();
            if (!compareSync(password, admin_user.passwordHash)) return callback();
            // update last visit out-of-band
            admin_user.lastVisit = new Date();
            admin_user.save(function (err) {
                if (err) console.error('error updating admin user', err);
            });
            return callback(admin_user);
        });
    };


    schema.formage = {
        section: 'Administration',
        form: AdminUserForm,
        list: ['username'],
        order_by: ['username']
    };

    return schema;
};


/**
 *
 * @constructor
 */
function AdminUserForm() {
    this.init.apply(this, arguments);
}
inherits(AdminUserForm, AdminForm);


AdminUserForm.prototype.init_fields = function () {
    AdminForm.prototype.init_fields.call(this);
    delete this.fields['passwordHash'];
    this.fields['current_password'] = new StringField({widget: 'PasswordWidget', label: 'Current Password', name: 'current_password'});
    this.fields['password'] = new StringField({widget: 'PasswordWidget', label: 'New Password', name: 'password'});
    this.fields['password_again'] = new StringField({widget: 'PasswordWidget', label: 'Again', name: 'password_again'});
};


AdminUserForm.prototype.validate = function () {
    var self = this;
    var p = new Promise();
    if (self.errors) {
        p.fulfill(_.isEmpty(self.errors));
        return p;
    }

    AdminForm.prototype.validate.call(this).then(function (isValid) {
        if (!isValid) {
            return p.fulfill(false);
        }

        if (_([self.data.current_password, self.data.current_password, self.data.password_again]).compact().isEmpty()) {
            return p.fulfill(true);
        }

        if (!self.instance.isNew) {
            if (!self.data.current_password) {
                self.errors['current_password'] = self.fields['current_password'].errors = ['Missing password'];
                return p.fulfill(false);
            }

            if (!compareSync(self.data.current_password, self.instance.passwordHash)) {
                self.errors['current_password'] = self.fields['current_password'].errors = ['Password incorrect'];
                return p.fulfill(false);
            }
        }

        if (self.data.password != self.data.password_again) {
            self.errors['password_again'] = self.fields['password_again'].errors = ['typed incorrectly'];
            return p.fulfill(false);
        }

        return p.fulfill(true);
    });
    return p;
};


AdminUserForm.prototype.save = function (callback) {
    var self = this;
    return this.validate().then(function (isValid) {
        if (!isValid) throw new Error('Not Valid');
        if (self.data.password)
            self.instance.passwordHash = encryptSync(self.data.password);
        return AdminForm.prototype.save.call(self, callback);
    });
};
