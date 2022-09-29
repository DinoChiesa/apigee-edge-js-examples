// findAppForApiProduct.js
// ------------------------------------------------------------------
//
// Copyright 2017-2019 Google LLC.
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
// last saved: <2022-September-29 10:14:12>

const apigeejs   = require('apigee-edge-js'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      util       = require('util'),
      Getopt     = require('node-getopt'),
      version    = '20220929-0953',
      getopt     = new Getopt(common.commonOptions.concat([
        ['P' , 'apiproduct=ARG', 'Required. the apiproduct for which to list apps.'],
        ['D' , 'developers', 'Optional. List the developers that own the apps.']
      ])).bindHelp();

function uniquify(value, index, self) {
    return self.indexOf(value) === index;
}

// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee findAppForApiProduct.js tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( !opt.options.apiproduct ) {
  console.log('You must specify an apiproduct to find');
  getopt.showHelp();
  process.exit(1);
}

apigee.connect(common.optToOptions(opt))
  .then(org => {
    opt.options.verbose && common.logWrite('searching...');
    return org.apps.get({expand:true})
      .then(result => {
        let apps = result.app;
        opt.options.verbose && common.logWrite('total count of apps for that org: %d', apps.length);
        //console.log(JSON.stringify(apps, null, 2));
        let filteredApps = apps.filter(app => {
              let creds = app.credentials && app.credentials.filter(cred =>
                                                 cred.apiProducts.find( prod =>
                                                                        (prod.apiproduct == opt.options.apiproduct)));
              return creds && (creds.length > 0);
            });


        if ( ! filteredApps || filteredApps.length == 0) {
          return [];
        }

        // if (opt.options.verbose) {
        //   common.logWrite('count of Apps containing %s (%d)', opt.options.apiproduct, filteredApps.length);
        //   common.logWrite(JSON.stringify(filteredApps, null, 2));
        // }

        // opt.options.verbose &&
        //     common.logWrite(ix + ': /v1/organizations/' + org.conn.orgname + '/developers/' + a.developerId + '/apps/' + a.name);

        if (opt.options.developers) {
          let developerList = filteredApps.map( a => a.developerId).filter(uniquify);
          let fn1 = (p, developer) =>
          p.then( acc =>
                  org.developers.get({id : developer})
                  .then(devRecord => {acc.developers.push(devRecord.email); return acc;}));

          return developerList.reduce(fn1, Promise.resolve({ developers: []}));
        }

        return {apps: filteredApps.map( a => ({developerId: a.developerId, name: a.name}))};
      });

  })

  .then( r => {
    console.log('' + JSON.stringify(r, null, 2));
  })

  .catch( e => console.log('while executing, error: ' + util.format(e)) );
