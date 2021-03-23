#! /usr/local/bin/node
/*jslint node:true */
// exportApi.js
// ------------------------------------------------------------------
// export one or more Apigee Edge proxy bundles
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
// last saved: <2021-March-23 12:03:09>

const fs       = require('fs'),
      path     = require('path'),
      mkdirp   = require('mkdirp'),
      util     = require('util'),
      apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      version  = '20210323-1147',
      defaults = { destination : 'exported' },
      getopt   = new Getopt(common.commonOptions.concat([
        ['' , 'name=ARG', 'name of existing API proxy or shared flow'],
        ['P' , 'pattern=ARG', 'regex pattern for name of existing API proxy or shared flow; this always exports the latest revision.'],
        ['D' , 'destination=ARG', 'directory for export. Default: exported'],
        ['t' , 'trial', 'trial only. Do not actually export'],
        ['R' , 'revision=ARG', 'revision of the asset to export. Default: latest']
      ])).bindHelp();

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

let opt = getopt.parse(process.argv.slice(2));


function exportOneProxyRevision(org, name, revision) {
  if (opt.options.trial) {
    common.logWrite('WOULD EXPORT HERE %s, revision:%s', name, revision);
    return sprintf("%s-r%s.zip", name, revision);
  }

  return org.proxies.export({name:name, revision:revision})
    .then( result => {
      fs.writeFileSync(path.join(opt.options.destination, result.filename), result.buffer);
      if (opt.options.verbose) {
        common.logWrite('export ok file: %s', result.filename);
      }
      return result.filename;
    });
}

function exportLatestRevisionOfProxy(org, name) {
  return org.proxies.getRevisions({name})
    .then( result => {
      let latestRevision = result[result.length - 1];
      return exportOneProxyRevision(org, name, latestRevision);
    });
}

function proxyExporter(org) {
  return function(item) {
    return exportLatestRevisionOfProxy(org, item);
  };
}

const exportLatestRevisionOfMatchingProxies = (org, pattern) =>
 org.proxies.get({})
    .then(result => {
      // match
      result = result.filter( a => a.match(new RegExp(pattern)) );
      let fn1 =
        (p, name) => p.then( acc => exportLatestRevisionOfProxy(org, name).then( r => [...acc, r]));
      return result.reduce(fn1, Promise.resolve([]));
    });


// ========================================================

if (opt.options.verbose) {

console.log(
  `Apigee Proxy Export tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

  common.logWrite('start');
}

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

mkdirp.sync(opt.options.destination);

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');

    if (opt.options.name && opt.options.revision) {
      return exportOneProxyRevision(org, opt.options.name, opt.options.revision);
    }
    if (opt.options.name) {
      return exportLatestRevisionOfProxy(org, opt.options.name);
    }
    if (opt.options.pattern) {
      return exportLatestRevisionOfMatchingProxies(org, opt.options.pattern);
    }

    throw new Error("Unexpected input arguments: no name and no pattern.");
  })

  .then( result => {
    common.logWrite('ok');
    console.log(JSON.stringify(result, null, 2));
  })

  .catch( e => console.log('while executing, error: ' + util.format(e)) );
