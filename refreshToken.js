#! /usr/local/bin/node
/*jslint node:true */
// refreshToken.js
// ------------------------------------------------------------------
// refresh a token for use with the Apigee Admin API, regardless of
// whether there is an existing token or if it is expired or not.
//
// Copyright 2019-2021 Google LLC.
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
// last saved: <2021-March-23 08:57:33>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      Getopt   = require('node-getopt'),
      version  = '20210323-0856',
      getopt   = new Getopt(common.commonOptions).bindHelp();

console.log(
  `Apigee Get Token, version: ${version}\n` +
    `Node.js ${process.version}\n`);

var opt = getopt.parse(process.argv.slice(2));

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then( org =>
    org.conn.getExistingToken()
      .then( existingToken => {
        if (opt.options.verbose) {
          let util = require('util');
          console.log(util.inspect(existingToken));
        }
      })
      .then( x =>
        org.conn.refreshToken()
          .then (token => {
            if (opt.options.verbose) {
              console.log();
            }
            console.log(token.access_token);
            if (opt.options.verbose) {
              let jwt = token.access_token,
                  jwtparts = jwt.split(new RegExp('\\.')),
                  payload = Buffer.from(jwtparts[1], 'base64').toString('utf-8'),
                  claims = JSON.parse(payload);
              console.log( '\nissuer: ' + claims.iss);
              console.log( 'user: ' + claims.user_name);
              console.log( 'issued at: ' + (new Date(claims.iat * 1000)).toISOString());
              console.log( 'expires: ' + (new Date(claims.exp * 1000)).toISOString());
              console.log( 'client_id: ' + claims.client_id);
            }
            return null;
          })))
  .catch( e => { console.error('error: ' + e);} );
