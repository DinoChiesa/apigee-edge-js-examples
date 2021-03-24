#! /usr/local/bin/node
/*jslint node:true */
// revokeOrApprove.js
// ------------------------------------------------------------------
// Revoke or approve (unrevoke) a developer, app, credential, or product-on-credential.
//
// Copyright 2017-2021 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// last saved: <2021-March-23 17:31:17>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      Getopt   = require('node-getopt'),
      version  = '20210323-1731',
      util     = require('util'),
      getopt   = new Getopt(common.commonOptions.concat([
        ['d' , 'developer=ARG', 'optional. the email of the developer to revoke.'],
        ['a' , 'app=ARG', 'optional. the developer app to revoke.'],
        ['k' , 'key=ARG', 'optional. the key (credential) to revoke.'],
        ['p' , 'product=ARG', 'optional. the product within the key to revoke.'],
        ['A' , 'approve', 'optional. use this flag to approve the product, key, app or developer.'],
        ['R' , 'revoke', 'optional. use this flag to revoke the product, key, app or developer.']
      ])).bindHelp();

var action = null;


// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee API product/key/dev/app revoker/approver tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

// Lots of valid combinations:
// can specify:
// - developer
// - developer and app
// - developer and app and key (over constrained)
// - developer and key (over constrained)
// - developer and app and key and product
// - key - must find the developer and app first
//
// Each one requires a slightly different workflow.
//

if ( opt.options.approve && opt.options.revoke) {
  common.logWrite('Specify one of -A or -R');
  getopt.showHelp();
  process.exit(1);
}
if ( opt.options.approve) {
  action = 'approve';
}
if ( opt.options.revoke) {
  action = 'revoke';
}
if ( ! action) {
  common.logWrite('Specify one of -A or -R');
  getopt.showHelp();
  process.exit(1);
}

apigee
  .connect(common.optToOptions(opt))
  .then( org => {
    if ( opt.options.key ) {
      // revoking the key (credential) or a product under a key
      let options = { key : opt.options.key };
      if ( opt.options.product ) {
        // revoke a product under a specific credential
        options.apiproduct = opt.options.product;
      }

      let act = () =>
      org.appcredentials[action](options)
        .then( result => common.logWrite('ok'));

      if ( ! opt.options.developer ) {
        // revoke / approve the key, or the single product under the key
        return act();
      }

      // The user specified both the key and the developer, let's make
      // sure they're consistent before performing the action.
      return org.appcredentials.find({key:opt.options.key})
        .then( found => {
          if ( ! found) {
            return common.logWrite('That key was not found.');
          }
          if (found.developer.email != opt.options.developer) {
            return common.logWrite('Error: mismatch between expected and actual developer.');
          }
          return act();
        });
    }

    if (opt.options.developer) {
      // revoking the developer or the app
      let options = { developer:opt.options.developer };

      if ( ! opt.options.app ) {
        // revoke / approve the developer
        return org.developers[action](options)
          .then( result => common.logWrite('ok'));
      }

      // revoke / approve the developer app (all keys)
      options.app = opt.options.app;
      return org.developerapps[action](options)
        .then( result => common.logWrite('ok'));
    }
    throw new Error('illegal parameters');
  })

  .catch( e => console.error('error: ' + util.format(e) ));
