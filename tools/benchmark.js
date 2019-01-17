/** Copyright 2018 Cisco and/or its affiliates

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
const ab = require('api-benchmark');

let services = {
  // "v3": "https://layout-service-edge.platform.2immerse.eu/layout/v3/",
  "v4": "http://localhost:3000/layout/v4/"
};

let routes = {
  "Create Context": {
    method: 'post',
    expectedStatusCode: 201,
    route: 'context',
    query: {
      deviceId: '*',
      reqDeviceId: '*'
    }
  },
  "List Contexts": {
    method: 'get',
    expectedStatusCode: 200,
    route: 'context',
    query: {
      deviceId: '*',
      reqDeviceId: '*'
    }
  }
};

let options = {
  debug: true,
  minSamples: 50,
  maxTime: 120,
  runMode: 'parallel'
};

// ab.compare(services, routes, options, (err, results) => { });
ab.measure(services, routes, options, (err, results) => { });
