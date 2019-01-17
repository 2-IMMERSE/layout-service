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
import * as commander from "commander";
import { Globals } from "./globals";
import { Logger } from "./Logger";
import { Server } from "./Server";

/**
 * specify where to find partner services in a full experience
 * and start the layout server
 *
 * test main used when not running with a full set of services.
 *
 * a mongodb instance MUST be running for the service to start
 * the server can run independently of the remaining services
 */
commander
  .option("-p, --port <port>", "Port to listen on", 3000)
  .option("-w, --websocket <service>", "WebSocket service name", "https://websocket-service-edge.platform.2immerse.eu/layout")
  .option("-t, --timeline <service>", "Timeline service name", "timeline-service-dev")
  .option("-m, --mongodb <host>", "MongoDB host name", "localhost")
  .option("-d, --database <database>", "Database name", "layout_service_dev")
  .option("-c, --consul <host>", "Consul host", "https://consul.service.consul:8500")
  .option("-D, --debug", "debug mode", false)
  .option("-v, --verbose", "Verbose logging (deprecated use '--log-level DEBUG' instead)", false)
  .option("-l, --log-level <level>", "Log level [DEBUG, INFO, WARN, ERROR, FATAL]", "INFO")
  .parse(process.argv);

// Setup logger
const logName = process.env.LOG_NAME || "LayoutServiceDev";
const logLevel = Logger.logLevelFromString(commander.logLevel);
Logger.configure(logName, logLevel);

Globals.configure("debug", commander.debug);

const server = new Server({
  consulURL: commander.consul,
  mongoService: commander.mongodb,
  websocketService: commander.websocket,
  timelineService: commander.timeline,
  databaseName: commander.database,
});
server.startLocal(commander.port);
