#! /usr/local/bin/node
/*jslint node:true */
// findApiKey.js
// ------------------------------------------------------------------
// find the developer and app name for an API key from an Edge org.
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
// last saved: <2021-March-23 17:20:44>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      Getopt   = require('node-getopt'),
      version  = '20210323-1718',
      util     = require('util'),
      getopt   = new Getopt(common.commonOptions.concat([
        ['k' , 'key=ARG', 'required. the key to find.']
      ])).bindHelp();

// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee API key finder, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( !opt.options.key ) {
  console.log('You must specify a key to find');
  getopt.showHelp();
  process.exit(1);
}

apigee
  .connect(common.optToOptions(opt))
  .then( org =>
         org.appcredentials.find({key:opt.options.key})
         .then( found => {
           if (found) {
             common.logWrite(JSON.stringify(found, null, 2));
             // common.logWrite('key: ' + found.key);
             // common.logWrite('app: ' + found.appName + ' ' + found.appId);
             // common.logWrite('dev: ' + found.developerId + ' ' +
             //                 found.developer.firstName + ' ' +
             //                 found.developer.lastName + ' ' +
             //                 found.developer.userName + ' ' +
             //                 found.developer.email);
           }
           else {
             common.logWrite('that key was not found.');
           }
         }))
  .catch( e => console.error('error: ' + util.format(e) ));
