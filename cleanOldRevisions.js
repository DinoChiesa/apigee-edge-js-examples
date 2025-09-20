#! /usr/local/bin/node
/* jshint node:true, esversion:9, strict:implied */
// cleanOldRevisions.js
// ------------------------------------------------------------------
// In Apigee, for all proxies AND sharedflows in an org, remove all
// but the latest N revisions. (Never remove a deployed revision).
//
// Copyright 2017-2023,2025 Google LLC.
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
// last saved: <2025-September-19 18:20:34>

const apigeejs = require("apigee-edge-js"),
  Getopt = require("node-getopt"),
  pLimit = require("p-limit"),
  util = require("node:util"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  version = "20250919-1637",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "R",
        "regexp=ARG",
        "Optional. Cull only proxies with names matching this regexp.",
      ],
      [
        "K",
        "numToKeep=ARG",
        "Required. Max number of revisions of each proxy to retain.",
      ],
      [
        "",
        "dry-run",
        "Optional. Dry-run. Do not delete, only summarize what WOULD be deleted.",
      ],
      [
        "",
        "collection=ARG",
        "Optional. Collection to cull. Either sharedflows or apiproxies. Default: both",
      ],
      [
        "",
        "magictoken",
        "Optional. Obtain a magic token from http://metadata.google.internal",
      ],
    ]),
  ).bindHelp();

const notDeployed = (result) =>
  (!result.environment || result.environment.length === 0) &&
  !result.deployments;

// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

const getMagicToken = async () => {
  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
    },
  );
  const data = await response.json();
  return data.access_token;
};

function examineRevisions(collection, name, revisions) {
  if (opt.options.verbose) {
    common.logWrite("revisions %s: %s", name, JSON.stringify(revisions));
  }
  if (revisions && revisions.length > opt.options.numToKeep) {
    revisions.sort((a, b) => a - b);
    let revisionsToExamine = revisions.slice(
      0,
      revisions.length - opt.options.numToKeep,
    );
    revisionsToExamine.reverse();

    // limit the number of concurrent requests
    const limit = pLimit(4);

    const mapper = (revision) =>
      limit((_) => {
        const options = { name, revision };
        return collection.getDeployments(options).then((result) => {
          if (opt.options.verbose) {
            common.logWrite(
              "deployments (%s r%s): %s",
              name,
              revision,
              JSON.stringify(result),
            );
          }
          return notDeployed(result)
            ? opt.options["dry-run"]
              ? revision
              : collection.del(options).then((_) => revision)
            : null;
        });
      });

    return Promise.all(revisionsToExamine.map(mapper)).then((revisions) => {
      revisions = revisions.filter((r) => r);
      if (revisions.length) {
        if (opt.options["dry-run"]) {
          common.logWrite(
            "would delete %s: %s",
            name,
            JSON.stringify(revisions),
          );
        } else if (opt.options.verbose) {
          common.logWrite("deleted %s: %s", name, JSON.stringify(revisions));
        }
        return { item: name, revisions };
      }
      return null;
    });
  }
  return Promise.resolve(null);
}

function validateCollection(v) {
  const allowedValues = ["sharedflows", "proxies", "apiproxies"];
  if (!allowedValues.includes(v)) {
    return null;
  }
  return [v === "apiproxies" ? "proxies" : v];
}

// ========================================================
async function main() {
  process.on("unhandledRejection", (r) =>
    console.log("\n*** unhandled promise rejection: " + util.format(r)),
  );

  if (opt.options.verbose) {
    console.log(
      `Apigee Proxy & Sharedflow revision cleaner tool, version: ${version}\n` +
        `Node.js ${process.version}\n`,
    );
    common.logWrite("start");
  }

  if (opt.options.magictoken) {
    opt.options.token = await getMagicToken();
    if (!opt.options.token) {
      console.log("could not get magic token\n");
      process.exit(1);
    }
    console.log("Got access token from metadata server....");
  }

  common.verifyCommonRequiredParameters(opt.options, getopt);

  if (!opt.options.numToKeep) {
    console.log("You must specify a number of revisions to retain. (-K)");
    getopt.showHelp();
    process.exit(1);
  }

  const collectionNames = opt.options.collection
    ? validateCollection(opt.options.collection)
    : ["sharedflows", "proxies"];

  if (!collectionNames) {
    console.log("You specified an invalid option for --collection");
    getopt.showHelp();
    process.exit(1);
  }

  return apigee
    .connect(common.optToOptions(opt))
    .then((org) => {
      const readOptions = {};
      const doOneCollection = (collectionName) => {
        const collection = org[collectionName];
        return collection.get(readOptions).then((results) => {
          if (results) {
            // convert for GAAMBO
            if (results.proxies && results.proxies.length) {
              results = results.proxies.map((r) => r.name);
            } else if (results.sharedFlows && results.sharedFlows.length) {
              results = results.sharedFlows.map((r) => r.name);
            }
          }
          if (opt.options.regexp) {
            const re1 = new RegExp(opt.options.regexp);
            results = results.filter((item) => re1.test(item));
          }
          if (!results || results.length == 0) {
            common.logWrite(
              "No %s%s",
              opt.options.regexp ? "matching " : "",
              collectionName,
            );
            return Promise.resolve(true);
          }

          if (opt.options.verbose) {
            console.log(JSON.stringify(results, null, 2));
            common.logWrite(
              "found %d %s%s",
              results.length,
              opt.options.regexp ? "matching " : "",
              collectionName,
            );
          }

          const reducer = (promise, itemname) =>
            promise.then((accumulator) =>
              collection.getRevisions({ name: itemname }).then(async (r) => {
                const x = await examineRevisions(collection, itemname, r);
                accumulator.push(x);
                return accumulator;
              }),
            );

          return results.reduce(reducer, Promise.resolve([]));
        });
      };

      const r = (promise, item) =>
        promise.then(async (accumulator) => {
          const x = await doOneCollection(item);
          accumulator.push(x);
          return accumulator;
        });

      return collectionNames.reduce(r, Promise.resolve([])).then((a) => {
        a = a.map((innerArray) => innerArray.filter((item) => item !== null));
        if (opt.options["dry-run"]) {
          common.logWrite("summary to delete: " + JSON.stringify(a));
        } else if (opt.options.verbose) {
          common.logWrite("summary deleted: " + JSON.stringify(a));
        }
      });
    })
    .catch((e) => console.error("error: " + util.format(e)));
}

main();
