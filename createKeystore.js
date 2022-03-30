#! /usr/local/bin/node
/*jslint node:true */
// createKeystore.js
// ------------------------------------------------------------------
// provision a keystore with a key and cert in Apigee, and create a reference
// to it. Or, provision a keystore as truststore, and upload a cert to it.
//
// example usage:
// node ./createKeystore.js --apigeex --token $TOKEN
//     --keypemfile ./example-private-key-20220330-1543.pem
//     --certpemfile ./example-cert-20220330-1543.pem
//     -o $ORG -e $ENV --keystore keystore1 --alias alias1
//
// Copyright 2017-2022 Google LLC.
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
// last saved: <2022-March-30 15:47:22>

const apigeejs   = require('apigee-edge-js'),
      fs         = require('fs'),
      util       = require('util'),
      utility    = apigeejs.utility,
      apigee     = apigeejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20220330-1535',
      getopt     = new Getopt(utility.commonOptions.concat([
        ['e' , 'environment=ARG', 'required. environment in which the keystore will be created'],
        ['s' , 'keystore=ARG', 'optional. name of the keystore to create. default: a generated random name'],
        ['' , 'certpemfile=ARG', 'required. path to the cert file'],
        ['' , 'alias=ARG', 'required. alias for the key'],
        ['' , 'keypemfile=ARG', 'optional. path to the key file (PEM format)'],
        ['P' , 'keypassword=ARG', 'optional. password for the RSA Key'],
        ['R' , 'reference=ARG', 'optional. reference to create or update']
      ])).bindHelp();

// ========================================================

console.log(
  `Apigee Keystore/Truststore creation tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

utility.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.environment ) {
  console.log('You must specify an environment');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.keystore ) {
  // contrive a name
  opt.options.keystore = new Date().toISOString(). replace(/-/g, '').substring(0,8) + '-' +
    Math.random().toString(36).substring(2, 15);
  utility.logWrite('using keystore: %s', opt.options.keystore);
}

if ( opt.options.keypemfile ) {
  if (!fs.existsSync(opt.options.keypemfile))  {
    console.log('You must specify a path to a valid file for the keypemfile');
    getopt.showHelp();
    process.exit(1);
  }
}

if ( !opt.options.certpemfile || !fs.existsSync(opt.options.certpemfile) ) {
  console.log('You must specify a path to a cert file');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.alias ) {
  console.log('You must specify an alias');
  getopt.showHelp();
  process.exit(1);
}

utility.verifyCommonRequiredParameters(opt.options, getopt);
apigee.connect(utility.optToOptions(opt))
  .then( org => {
    if (opt.options.verbose) {
      utility.logWrite('connected');
    }
    return org.keystores.get({ environment : opt.options.environment })
      .then(result => {
        let options = {
              environment : opt.options.environment,
              name : opt.options.keystore
            };
        let p = null;
        if (result.indexOf(opt.options.keystore)>=0) {
          // exists
          p = org.keystores.getAliases(options)
            .then( result => {
              //utility.logWrite('keystore getAliases %s', JSON.stringify(result));
              if (result.indexOf(opt.options.alias)>=0) {
                return Promise.reject('that alias already exists.');
              }
            });
        }
        else {
          // does not exist, create it
          p =  org.keystores.create(options)
            .then( result => {
              if (opt.options.verbose) {
                utility.logWrite('created keystore %s', opt.options.keystore);
              }
            });
        }

        return p.then( _ => {
          options.certFile = opt.options.certpemfile;
          options.alias = opt.options.alias;
          if ( opt.options.keypemfile ) {
            options.keyFile = opt.options.keypemfile;
            if (opt.options.keypassword) {
              options.keyPassword = opt.options.keypassword;
            }
          }
          return org.keystores.importCert(options)
            .then(result => {
              if (opt.options.verbose) {
                utility.logWrite('%scert stored.', ( opt.options.keypemfile) ? "key and " :"");
              }
              if ( ! opt.options.reference) {
                const o = {
                        org: org.conn.orgname,
                        env: opt.options.environment,
                        keystore: opt.options.keystore,
                        ref: '-none-',
                        now: (new Date()).toISOString()
                      };
                if ( opt.options.keypemfile ) {
                  o.keyalias = opt.options.alias;
                }
                console.log('\nsummary: ' + JSON.stringify(o, null, 2));
                return Promise.resolve(true);
              }
              const options = {
                      name : opt.options.reference,
                      refers : opt.options.keystore,
                      environment : opt.options.environment
                    };
              return org.references.createOrUpdate(options)
                .then( result => {
                  if (opt.options.verbose) {
                    utility.logWrite('reference %s created or updated.', opt.options.reference);
                    const o = {
                            org: org.conn.orgname,
                            env: opt.options.environment,
                            keystore: opt.options.keystore,
                            ref: opt.options.reference,
                            now: (new Date()).toISOString()
                          };
                    if ( opt.options.keypemfile ) {
                      o.keyalias = opt.options.alias;
                    }
                    console.log('\nsummary: ' + JSON.stringify(o, null, 2));
                  }
                });
            });
        });
      });
  })
  .catch(e => console.log(util.format(e)));
