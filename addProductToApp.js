#! /usr/local/bin/node
/*jslint node:true */
// addProductToApp.js
// ------------------------------------------------------------------
// add a product authorization to each credential in a given app.
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
// last saved: <2020-April-10 12:33:38>

const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      util       = require('util'),
      version    = '20200410-1007',
      getopt     = new Getopt(common.commonOptions.concat([
      ['p' , 'product=ARG', 'required. name of the API product to enable on this app'],
      ['E' , 'email=ARG', 'required. email address of the developer for which to create the app'],
      ['A' , 'appname=ARG', 'required. name for the app']
    ])).bindHelp();

// ========================================================

console.log(
  'Apigee Edge App Credential / Product tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.email ) {
  console.log('You must specify an email address');
  getopt.showHelp();
  process.exit(1);
}

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

common.verifyCommonRequiredParameters(opt.options, getopt);
apigeeEdge.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');
    return org.developerapps.get({
      developerEmail : opt.options.email,
      appName : opt.options.appname
    })
      .then( app => {
        //console.log(JSON.stringify(app, null, 2));
        const optionsBase = {
                developerEmail: opt.options.email,
                appName: opt.options.appname,
                product: opt.options.product
              };
        const reducer = (promise, item) =>
          promise .then( accumulator =>
                         org.appcredentials.addProduct({...optionsBase, consumerKey: item.consumerKey})
                         .then( result => [ ...accumulator, {item} ] )
                       );
        return app.credentials
          .reduce(reducer, Promise.resolve([]))
          .then( r => console.log('ok'));
      });
  })
  .catch( e => console.error('error connecting: ' + util.format(e) ) );
