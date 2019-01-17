+++
title = "API Documentation"
weight = 1
+++
# API Documentation

# Overview

The Layout Service uses the following concepts:

* Context – a group of devices in an environment participating in a multiscreen experience.
* Devices – communal or personal. Device display resources can be partitioned into regions. Each device registers it capabilities on joining context, including any regions.
* DMApp – a ‘distributed media app’. From a layout perspective, will comprise a set of components whose lifecycle will be managed by an external entity (typically the timeline service) through the transaction API, and a constraints document defining how those components should be laid out.
* Components – entities which are laid out. Components have a lifecycle (init -> start -> stop -> destroy)
* Constraints – rules that define how components are laid out into regions / devices

The Basic high level flow for using the Layout Service is as follows:

* Client creates context
 * Other devices may also join context… (typically they would discover the contextId by discovering the context-creating client device through DIAL, and then getting the contextId via App2App)
* Client loads DMApp into the context (specifies a layout constraints doc, the timeline service & a timeline doc; the layout service will request the timeline service loads this doc on behalf of the client...)
* Timeline service executes timeline document, and manages component lifecycle(s) through transaction API calls (this supports batched Init/start/stop/destroy component  actions)
* The client may override some constraints (e.g. change priorities)
* Layout service re-evaluates layout as required, and will push websocket layout messages to the clients which adapt presentation accordingly
* Optionally, the DMApp can be unloaded, and the context destroyed.

For detailed API documentation, please refer to the generated documentation below...

* [Generated Documentation](https://origin.platform.2immerse.eu/docs/api/layout-service/)

# Licensing
   Copyright 2018 Cisco and/or its affiliates

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


