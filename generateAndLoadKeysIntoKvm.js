#! /usr/local/bin/node
/*jslint node:true */
// generateAndLoadKeysIntoKvm.js
// ------------------------------------------------------------------
// generate an RSA 256-bit keypair and load into Apigee Edge KVM
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
// last saved: <2021-April-21 16:59:28>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.edge,
      sprintf  = require('sprintf-js').sprintf,
      util     = require('util'),
      NodeRSA  = require('node-rsa'),
      uuidV4   = require('uuid/v4'),
      Getopt   = require('node-getopt'),
      version  = '20210421-1644',
      defaults = { privkeysmap : 'PrivateKeys', pubkeysmap: 'NonSecrets', kidmap: 'NonSecrets' },
      getopt   = new Getopt(common.commonOptions.concat([
        ['e' , 'env=ARG', 'required. the Edge environment for which to store the KVM data'],
        ['b' , 'keystrength=ARG', 'optional. strength in bits of the RSA keypair. Default: 2048'],
        ['K' , 'privkeysmap=ARG', 'optional. name of the KVM in Edge for keys. Will be created if nec. Default: ' + defaults.privkeysmap],
        ['I' , 'kidmap=ARG', 'optional. name of the KVM in Edge for Key IDs. Will be created if nec. Default: ' + defaults.kidmap]
      ])).bindHelp();

// ========================================================

function loadKeysIntoMap(org) {
  var uuid = uuidV4();
  var re = new RegExp('(?:\r\n|\r|\n)', 'g');
  var keypair = new NodeRSA({b: opt.options.keystrength});
  var publicKeyPem = keypair.exportKey('pkcs8-public-pem').replace(re,'\\n');
  var privateKeyPem = keypair.exportKey('pkcs8-private-pem').replace(re,'\\n');
  var options = {
        env: opt.options.env,
        kvm: opt.options.privkeysmap,
        key: 'private__' + uuid,
        value: privateKeyPem
      };
  common.logWrite(sprintf('provisioning new key %s', uuid));
  return org.kvms.put(options)
    .then(_ => {
    options.kvm = opt.options.pubkeysmap;
    options.key = 'public__' + uuid;
    options.value = publicKeyPem;
      return org.kvms.put(options);
    })
    .then(_ => {
      options.kvm = opt.options.kidmap;
      options.key = 'currentKid';
      options.value = uuid;
      return org.kvms.put(options);
    });
}


function createOneKvm(org) {
  return function(mapname, cb) {
    // create KVM.  Use encrypted if it is for keys.
  };
}

function dedupe(e, i, c) { // extra step to remove duplicates
  return c.indexOf(e) === i;
}

// ========================================================

// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee Edge KVM Provisioning tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

  common.logWrite('start');
}

if ( !opt.options.env ) {
  console.log('You must specify an environment');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.privkeysmap ) {
  common.logWrite(sprintf('defaulting to %s for privkeys map', defaults.privkeysmap));
  opt.options.privkeysmap = defaults.privkeysmap;
}
if ( !opt.options.pubkeysmap ) {
  common.logWrite(sprintf('defaulting to %s for pubkeys map', defaults.pubkeysmap));
  opt.options.pubkeysmap = defaults.pubkeysmap;
}
if ( !opt.options.kidmap ) {
  common.logWrite(sprintf('defaulting to %s for kid map', defaults.kidmap));
  opt.options.kidmap = defaults.kidmap;
}

if ( ! opt.options.keystrength ) {
  opt.options.keystrength = 2048; // default
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then(org => {
    common.logWrite('connected');

    return org.kvms.get({ env: opt.options.env })
      .then( result => {

        let missingMaps = [opt.options.privkeysmap,
                           opt.options.pubkeysmap,
                           opt.options.kidmap]
          .filter(value => result.indexOf(value) == -1)
          .filter(dedupe);

        let p = Promise.resolve({});
        if (missingMaps && missingMaps.length > 0) {
          common.logWrite('Need to create one or more maps');

          let fn1 = (p, name) =>
          p.then( acc =>
                  org.kvms.create({
                    env: opt.options.env,
                    name,
                    encrypted:(name == opt.options.privkeysmap)})
                  .then( _ => [...acc, name]));

          p = p
            .then( missingMaps.reduce(fn1, Promise.resolve([]) ));
        }
        else {
          common.logWrite('ok. the required maps exist');
        }
        p = p
          .then( _ => loadKeysIntoMap(org))
          .then( _ =>   common.logWrite('ok. the keys were loaded successfully.'));

      });
  })
  .catch( e => console.log('while executing, error: ' + util.format(e)) );
