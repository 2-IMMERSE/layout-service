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
import { Request, Response } from "express";
import * as log4js from "log4js";

/**
 * Optional log levels
 */
export enum LogLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
  FATAL,
}

/**
 * Utility class for formatting log message
 */
export class Logger {
  /** Default log4js config */
  public static config: any = {
    appenders: [
      {
        type: "categoryFilter",
        exclude: ["response"],
        appender: {
          type: "console",
          exclude: ["response"],
          layout: {
            type: "pattern",
            pattern: "2-Immerse subSource:%c level:%p %m sourcetime:%d{ISO8601_WITH_TZ_OFFSET} source:",
          },
        },
      },
      {
        type: "console",
        category: "response",
        level: "DEBUG",
        layout: {
          type: "pattern",
          pattern: "%d{ISO8601_WITH_TZ_OFFSET} %m",
        },
        appender: {},
      },
    ],
    levels: {
      consul: "WARN",
      server: "WARN",
      api: "INFO",
      request: "INFO",
      response: "DEBUG",
      ws: "WARN",
      timeline: "WARN",
      layout: "WARN",
      dmapp: "WARN",
      packer: "WARN",
      cors: "WARN",
    },
    replaceConsole: true,
  };

  public static level: LogLevel;

  /**
   * Configure the log4js loggers
   *
   * @param label - Label to use for logstash messages
   * @param level - Log level for filtering messages
   */
  public static configure(label: string = "LayoutServiceEdge", level: LogLevel = LogLevel.INFO): void {
    const config = Logger.config;
    config.appenders[0].appender.layout.pattern += label;

    Object.keys(config.levels).forEach((key) => {
      config.levels[key] = LogLevel[level];
    });

    log4js.configure(config);
    this.level = level;
  }

  public static logLevelFromString(level: string): LogLevel {
    switch (level) {
      case "FATAL":
        return LogLevel.FATAL;
      case "ERROR":
        return LogLevel.ERROR;
      case "WARN":
        return LogLevel.WARN;
      case "DEBUG":
        return LogLevel.DEBUG;
      case "INFO":
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Format a message for logging
   *
   * @param msg - Message to format. If Error then stack used
   * @param ctx - Context to use for prefixing messages
   */
  public static formatMessage(msg: any, ctx?: any): string {
    let prefix = "";

    if (ctx !== undefined) {
      if (typeof(ctx) === "string") {
        const err = new Error();
        console.error("formatMessage called with string ctx argument: " +  err.stack) ; // tslint:disable-line
      } else {
        Object.keys(ctx).forEach((key) => {
          if (ctx.hasOwnProperty(key)) {
            // log format needs to be specific for logstash
            prefix += key.replace(/([idID]{2})$/, "ID") + ":" + ctx[key] + " ";
          }
        });
      }
    }

    if (msg instanceof Error) {
      msg = msg.stack;
    }

    // strip out any line breaks
    return (prefix + "logmessage:'" + msg.substr(0, 7500).toString().replace(/'/g, "\"") + "'").replace(/(\r\n|\n|\r)/gm, " ");
  }

  /**
   * Format a request for logging
   *
   * @param req - Request to format
   */
  public static formatRequest(req: Request, body?: any): string {
    return "method:" + req.method + " url: " + req.url + " body:" + JSON.stringify(body);
  }

  /**
   * Format a response for logging
   *
   * @param res - Response to format
   */
  public static formatResponse(req: Request, res: Response, body?: any): string {
    return "response:" + res.statusCode + " url: " + req.url + " body:" + JSON.stringify(body);
  }
}
