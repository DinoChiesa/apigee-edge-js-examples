#! /usr/local/bin/node
/*jslint node:true */
// findApiProductForProxy.js
// ------------------------------------------------------------------
//
/* global process */
/* jshint esversion:9, node:true, strict:implied */

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
// created: Mon Mar 20 09:57:02 2017
// last saved: <2022-August-19 11:12:18>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      Getopt   = require('node-getopt'),
      util     = require('util'),
      version  = '20220819-1112',
      getopt   = new Getopt(common.commonOptions.concat([
        ['P' , 'proxy=ARG', 'required. the proxy to find.']
      ])).bindHelp();

// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee findApiProductForProxy.js tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( !opt.options.proxy ) {
  console.log('You must specify a proxy to find');
  getopt.showHelp();
  process.exit(1);
}

apigee
  .connect(common.optToOptions(opt))
  .then(org =>
        org.products.get({expand:true})
        .then(result => {
          //console.log('RESULT: ' + JSON.stringify(result, null, 2));
          let apiproducts = result.apiProduct;
          common.logWrite('total count of API products for that org: %d', apiproducts.length);

          // For the old config model, the product object has a "proxies" child.
          // For the new model, the product object has children "operationGroup"
          // and "graphqlOperationGroup".
          //
          // ex:
          // "operationGroup": {
          //    "operationConfigs": [
          //      {
          //        "apiSource": "oauth-test",
          //        "operations": [
          //          {
          //            "resource": "/t2",
          //            "methods": [
          //              "GET"
          //            ]
          //          }
          //        ],
          //        "quota": {}
          //      },
          //      {
          //        "apiSource": "oauth-test",
          //        "operations": [
          //          {
          //            "resource": "/t1",
          //            "methods": [
          //              "GET"
          //            ]
          //          }
          //        ],
          //        "quota": {}
          //      }
          //    ],
          //    "operationConfigType": "proxy"
          //  },
          //  "graphqlOperationGroup": {
          //    "operationConfigs": [
          //      {
          //        "apiSource": "frankfurter-oauth",
          //        "operations": [
          //          {
          //            "operationTypes": [
          //              "QUERY"
          //            ],
          //            "operation": "SampleQuery"
          //          }
          //        ],
          //        "quota": {}
          //      }
          //    ],
          //    "operationConfigType": "proxy"
          //  }
          //
          // Need to inspect that to produce results.
          //
          let groupContainsProxy = (group) => group && group.operationConfigs &&
                group.operationConfigs.some(config => config.apiSource == opt.options.proxy);

          let filtered = apiproducts.filter( product =>
                                           // old model
                                           (product.proxies && product.proxies.length && product.proxies.indexOf(opt.options.proxy) >= 0) ||
                                           // new model - REST
                                           groupContainsProxy(product.operationGroup) ||
                                           // new model - GraphQL
                                           groupContainsProxy(product.graphqlOperationGroup));

          if (filtered && filtered.length) {
            common.logWrite('count of API products authorized for %s: %d', opt.options.proxy, filtered.length);
            if (filtered.length) {
              common.logWrite('list: ' + filtered.map( item => item.name).join(', '));
            }
            if ( opt.options.verbose ) {
              common.logWrite(JSON.stringify(filtered, null, 2));
            }
          }
          else {
            common.logWrite(`No API products containing ${opt.options.proxy}`);
          }
          return Promise.resolve(true);
        }))
  .catch( e => console.error('error: ' + util.format(e) ) );
