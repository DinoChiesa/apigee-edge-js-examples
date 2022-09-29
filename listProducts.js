#! /usr/local/bin/node
/*jslint node:true */
// listProxies.js
// ------------------------------------------------------------------
// list products in Apigee
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
// last saved: <2022-September-29 10:07:00>

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20220929-0956',
      getopt     = new Getopt(common.commonOptions.concat([
          ['E' , 'elaborate', 'Optional. show the expanded product information.'],
      ])).bindHelp();

// ========================================================
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee List Products tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

  common.logWrite('start');
}

// process.argv array starts with 'node' and 'scriptname.js'
common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then(org =>
        org.products.get(opt.options.elaborate ? {expand:true} : {})
        .then(resp => // GAAMBO
              (resp.apiProduct) ? resp.apiProduct: resp)
        .then(a =>
              (opt.options.elaborate) ? a : a.map(x => x.name)))

  .then(results => console.log('results: ' + JSON.stringify(results, null, 2)))
  .catch( e => console.error('error: ' + util.format(e) ) );
