#! /usr/local/bin/node
/*jslint node:true */
// exportApiPromises.js
// ------------------------------------------------------------------
// export one or more Apigee Edge proxy bundles
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
// last saved: <2020-August-25 15:34:45>

const fs         = require('fs'),
      path       = require('path'),
      mkdirp     = require('mkdirp'),
      edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20200825-1534',
      defaults   = { destination : 'exported' },
      getopt     = new Getopt(common.commonOptions.concat([
        ['N' , 'name=ARG', 'name of existing API proxy or shared flow'],
        ['P' , 'pattern=ARG', 'regex pattern for name of existing API proxy or shared flow; this always exports the latest revision.'],
        ['D' , 'destination=ARG', 'directory for export. Default: exported'],
        ['t' , 'trial', 'trial only. Do not actually export'],
        ['R' , 'revision=ARG', 'revision of the asset to export. Default: latest']
      ])).bindHelp();

function exportOneProxyRevision(org, name, revision) {
  return new Promise( (resolve, reject) => {
    if (opt.options.trial) {
      common.logWrite('WOULD EXPORT HERE %s, revision:%s', name, revision);
      return resolve(path.join(opt.options.destination, sprintf("%s-%s-TIMESTAMP.zip", name, revision)));
    }
    return org.proxies.export({name:name, revision:revision})
      .then(result => {
        let fullFilename = path.join(opt.options.destination, result.filename);
        fs.writeFileSync(fullFilename, result.buffer);
        //common.logWrite('export ok file: %s', result.filename);
        return resolve(fullFilename);
      });
  });
}

function exportLatestRevisionOfProxy(org, name) {
  return org.proxies.getRevisions({name:name})
    .then(revisions =>
          exportOneProxyRevision(org, name, revisions[revisions.length - 1]) );
}

function proxyExporter(org) {
  return function(item, cb) {
    return exportLatestRevisionOfProxy(org, item, cb);
  };
}

function exportLatestRevisionOfMatchingProxies(org, pattern, cb) {
  let re1 = new RegExp(pattern);
  return org.proxies.get({})
    .then( result => {
      const reducer = (promise, proxy) =>
        promise .then( accumulator =>
                       exportLatestRevisionOfProxy(org, proxy)
                       .then( filename => [ ...accumulator, {proxy, filename} ] ));

      return result
        .filter( a => a.match(re1) )
        .reduce(reducer, Promise.resolve([]));
    });
}


// ========================================================

console.log(
  'Apigee Edge Proxy Export tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.name && !opt.options.pattern ) {
  console.log('You must specify a name, or a pattern for the name, for the proxy or sharedflow to be exported');
  getopt.showHelp();
  process.exit(1);
}

if ( opt.options.name && opt.options.pattern ) {
  console.log('You must specify only one of a name, or a pattern for the name, for the proxy or sharedflow to be exported');
  getopt.showHelp();
  process.exit(1);
}

if ( opt.options.revision && opt.options.pattern) {
  console.log('You may not specify a revision when specifying a pattern. Doesn\'t make sense.');
  getopt.showHelp();
  process.exit(1);
}

if ( ! opt.options.destination) {
  opt.options.destination = defaults.destination;
}

if ( ! opt.options.trial) {
  mkdirp.sync(opt.options.destination);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigeeEdge.connect(common.optToOptions(opt))
  .then(org => {
    common.logWrite('connected');

    if (opt.options.name && opt.options.revision) {
      common.logWrite('exporting');
      return exportOneProxyRevision(org, opt.options.name, opt.options.revision);
    }

    if (opt.options.name) {
      return exportLatestRevisionOfProxy(org, opt.options.name);
    }

    if (opt.options.pattern) {
      return exportLatestRevisionOfMatchingProxies(org, opt.options.pattern)
        .then (result => JSON.stringify(result, null, 2));
    }

    return Promise.resolve(common.logWrite("Unexpected input arguments: no name and no pattern."));
  })
  .then (result => console.log('\n' + result + '\n'))
  .catch(e => common.logWrite(JSON.stringify(e, null, 2)));
