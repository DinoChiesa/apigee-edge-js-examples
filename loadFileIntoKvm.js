#! /usr/local/bin/node
/*jslint node:true */
// loadFileIntoKvm.js
// ------------------------------------------------------------------
// load the contents of a text file into Apigee KVM
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
// last saved: <2021-March-23 08:52:22>

const fs         = require('fs'),
      apigeejs   = require('apigee-edge-js'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      util       = require('util'),
      Getopt     = require('node-getopt'),
      version    = '20210323-0851',
      defaults   = { mapname : 'settings' },
      getopt     = new Getopt(common.commonOptions.concat([
        ['e' , 'env=ARG', 'required. the Edge environment for which to store the KVM data'],
        ['m' , 'mapname=ARG', 'optional. name of the KVM in Apigee. Will be created if nec. Default: ' + defaults.mapname],
        ['E' , 'encrypted', 'optional. use an encrypted KVM. Applies only if creating a new KVM. Default: not.'],
        ['F' , 'file=ARG', 'required. the filesystem file to read, to get the content.'],
        ['' , 'entryname=ARG', 'required. name of the entry in KVM to store the content.']
    ])).bindHelp();

// ========================================================

function loadFileIntoMap(org) {
  let re = new RegExp('(?:\r\n|\r|\n)', 'g'),
      content = fs.readFileSync(opt.options.file, "utf8").replace(re,'\n'),
      options = {
        env: opt.options.env,
        kvm: opt.options.mapname,
        key: opt.options.entryname,
        value: content
      };
  common.logWrite('storing new key \'%s\'', opt.options.entryname);
  return org.kvms.put(options)
    .then( _ => common.logWrite('ok. the key was loaded successfully.'));
}

// ========================================================

console.log(
  `Apigee KVM-loader tool, version: ${version}\nNode.js ${process.version}\n`);

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

common.logWrite('start');

var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.env ) {
  console.log('You must specify an environment');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.entryname ) {
  console.log('You must specify an entryname');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.mapname ) {
  common.logWrite(sprintf('defaulting to %s for KVM mapname', defaults.mapname));
  opt.options.mapname = defaults.mapname;
}

common.verifyCommonRequiredParameters(opt.options, getopt);
apigee.connect(common.optToOptions(opt))
  .then ( org => {
    common.logWrite('connected');
    return org.kvms.get({ env: opt.options.env })
      .then( maps => {
        if (maps.indexOf(opt.options.mapname) == -1) {
          // the map does not yet exist
          common.logWrite('Need to create the map');
          return org.kvms.create({ env: opt.options.env, name: opt.options.mapname, encrypted:opt.options.encrypted})
            .then( _ => loadFileIntoMap(org) );
        }

        common.logWrite('ok. the required map exists');
        return loadFileIntoMap(org);
      });
  })
  .catch( e => console.log('Error: ' + util.format(e)));
