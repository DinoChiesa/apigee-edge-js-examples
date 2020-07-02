#! /usr/local/bin/node
/*jslint node:true */
// addAppCredential.js
// ------------------------------------------------------------------
//
// Add a new credential to a developer app in Apigee Edge. If the developer app
// does not exist, it is created.  The credential consists of a client id and
// secret. You can explicitly specify either or both.
//
//
// Copyright 2017-2020 Google LLC.
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
// last saved: <2020-July-01 17:34:51>

const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      util       = require('util'),
      version    = '20200701-1634',
      credlengths = { MAX: 256, MIN: 16, DEFAULT: 52 },
      defaults   = { credlength : credlengths.DEFAULT },
      getopt     = new Getopt(common.commonOptions.concat([
      ['p' , 'product=ARG', 'required. name of the API product to enable on this app, or a comma-separated list of names.'],
      ['E' , 'email=ARG', 'required. email address of the developer for which to create the app.'],
      ['A' , 'appname=ARG', 'required. name for the app.'],
      ['I' , 'clientid=ARG', 'optional. the new client id to use for this credential. Default: auto-generated.'],
      ['S' , 'secret=ARG', 'optional. the new client secret for this credential. Default: auto-generated.'],
      ['L' , 'credlength=ARG', 'optional. the length for any generated credential: Default: ' + defaults.credlength],
      ['x' , 'expiry=ARG', 'optional. expiry for the credential. Does not work with explicitly specified client id.']
    ])).bindHelp();

function randomString(L){
  L = L || defaults.credlength;
  let s = '';
  do {s += Math.random().toString(36).substring(2, 15); } while (s.length < L);
  return s.substring(0,L);
}

function ensureAppExists(org, options) {
  //require('request').debug = true;
  return org.developerapps.get(options)
    .then(app => ({app, isNew:false}))
    .catch( async e => {
      let s = String(e);
      if (s == "Error: bad status: 404") {
        common.logWrite('That app does not exist.... creating it.');
        return org.developerapps.create(options)
          .then( app => ( {app, isNew:true} ) );
      }
      else {
        console.error('error: ' + util.format(e) );
        return Promise.reject(e);
      }
    });
}

function getValidCredLength() {
  let credlength = opt.options.credlength || defaults.credlength;
  return Math.min(Math.max(credlength, credlengths.MIN), credlengths.MAX);
}

function invalidCredLength(cred) {
  return cred.length < credlengths.MIN || cred.length > credlengths.MAX;
}

function getValidCred(name) {
  let cred = opt.options[name];
  if ( ! cred ) {
    cred = randomString(getValidCredLength());
  }
  if (invalidCredLength(cred)) {
    common.logWrite(`INFO: invalid length for the explicitly-provided value for ${name}. Overriding it.`);
    cred = randomString(getValidCredLength());
  }
  return cred;
}

// ========================================================

console.log(
  'Apigee Edge App Credential tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.appname ) {
  console.log('You must specify a name of an app');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.product ) {
  console.log('You must specify an API Product');
  getopt.showHelp();
  process.exit(1);
}

// if ( opt.options.clientid ) {
//   console.log('You must specify a clientid');
//   getopt.showHelp();
//   process.exit(1);
// }

if ( !opt.options.email ) {
  console.log('You must specify an email address');
  getopt.showHelp();
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigeeEdge.connect(common.optToOptions(opt))
  .then ( org => {
    common.logWrite('connected');
    return org.developers.get({ developerEmail : opt.options.email })
      .then( dev => {
        let options = {
              developerEmail : opt.options.email,
              appName : opt.options.appname,
              apiProduct : opt.options.product.split(','),
              expiry : opt.options.expiry
            };
        // There are 4 different cases, corresponding to the 2x2 matrix of
        // possibilities:
        // App already exists, or not.
        // User is providing credentials, or not.
        //
        return ensureAppExists(org, options)
          .then(({app, isNew}) => {
            let p = Promise.resolve({app});
            if (opt.options.clientid || opt.options.secret) {
              // an explicitly supplied clientid or secret, or both.
              if (isNew) {
                // The app has just been newly created. The user has explicitly
                // supplied credentials. Therefore, delete the existing
                // credential and add a new one.
                let options2 = {
                      consumerKey : app.credentials[0].consumerKey,
                      appName : opt.options.appname,
                      developerEmail : opt.options.email
                    };
                p = p.then( _ => org.appcredentials.del(options2) );
              }
              else {
                // not a new app, so no need to delete newly-created credential
              }
              // add the specified new credential
              p = p.then( _ => {
                options.clientId = getValidCred("clientid");
                options.clientSecret = getValidCred("secret");
                if (opt.options.expiry) {
                  common.logWrite('WARNING: it is not possible to set a credential expiry with an explicitly-supplied client id and secret');
                }
                return org.appcredentials.add(options);
              });
            }
            else {
              if ( ! isNew) {
                // not a new app, we want to add a *apigee generated* credential
                p = p.then(_ => org.appcredentials.add(options))
                  .then( app => app.credentials[0]);
              }
              else {
                // transform for the output
                p = p.then( _ => app.credentials[0]);
              }
            }
            return p;
          })
          .then( r => console.log('result: ' + util.format(r)));
      })
      .catch( e => {
        let s = String(e);
        if (s == "Error: bad status: 404") {
          switch (e.result.code) {
          case "keymanagement.service.InvalidClientIdForGivenApp":
            console.log('That clientId is invalid. Duplicate?');
            break;
          case "developer.service.DeveloperDoesNotExist":
            console.log('That developer does not exist.');
            break;
          default :
            console.log(e.code);
            console.log('Unknown error.');
            break;
          }
        }
        else {
          console.error('error: ' + util.format(e) );
        }
      });
  })
  .catch( e => console.error('error connecting: ' + util.format(e) ) );
