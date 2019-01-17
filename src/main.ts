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
import { Logger } from "./Logger";
import { Server } from "./Server";

/**
 * specify where to find partner services in a full experience
 * and start the layout server
 */
commander
  .option("-p, --port <port>", "Port to listen on", 3000)
  .option("-w, --websocket <service>", "WebSocket service name", "websocket-service-dev")
  .option("-t, --timeline <service>", "Timeline service name", "timeline-service-dev")
  .option("-m, --mongodb <service>", "MongoDB service name", "mongodb-dev")
  .option("-d, --database <database>", "Database name", "layout_service")
  .option("-c, --consul <host>", "Consul host", "https://consul.service.consul:8500")
  .option("-v, --verbose", "Verbose logging (deprecated use '--log-level DEBUG' instead)", false)
  .option("-l, --log-level <level>", "Log level [DEBUG, INFO, WARN, ERROR, FATAL]", "INFO")
  .parse(process.argv);

// Setup logger
const logName = process.env.LOG_NAME || "LayoutServiceEdge";
const logLevel = Logger.logLevelFromString(commander.logLevel);
Logger.configure(logName, logLevel);

const server = new Server({
  consulURL: commander.consul,
  mongoService: commander.mongodb,
  websocketService: commander.websocket,
  timelineService: commander.timeline,
  databaseName: commander.database,
});
server.start(commander.port);
