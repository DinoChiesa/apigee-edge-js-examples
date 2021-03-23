#! /usr/local/bin/node
/*jslint node:true */
// getToken.js
// ------------------------------------------------------------------
// authenticate, get a token suitable for use with the Apigee Admin API.
// This works with Apigee X; use a service-account key file.
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
// last saved: <2021-March-23 08:51:17>

const apigeejs   = require('apigee-edge-js'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      Getopt     = require('node-getopt'),
      version    = '20210323-0851',
      getopt     = new Getopt(common.commonOptions).bindHelp();

let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Edge Get Token, version: ${version}\n` +
      `Node.js ${process.version}\n`);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

// apigee.connect() will connect by using an existing token, or by
// getting a new token, depending on the passed-in options as well as
// the state of any existing (cached) access_token and refresh_token.
apigee.connect(common.optToOptions(opt))
  .then( org =>
      org.conn.getExistingToken()
      .then( existingToken => {
        console.log('\n' + existingToken.access_token);
        if (opt.options.verbose) {
          let jwt = existingToken.access_token,
              jwtparts = jwt.split(new RegExp('\\.')),
              payload = Buffer.from(jwtparts[1], 'base64').toString('utf-8');
          try {
            let claims = JSON.parse(payload);
            console.log( '\nissuer   : ' + claims.iss);
            console.log( 'user     : ' + claims.user_name);
            console.log( 'issued at: ' + (new Date(claims.iat * 1000)).toISOString());
            console.log( 'expires  : ' + (new Date(claims.exp * 1000)).toISOString());
            console.log( 'now      : ' + (new Date()).toISOString());
            console.log( 'client_id: ' + claims.client_id);
          }
          catch (e) {
            // gulp
          }
        }
      }))
  .catch( e => console.error('error: ' + e) );
