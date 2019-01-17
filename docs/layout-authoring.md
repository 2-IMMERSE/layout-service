+++
title = "layout Authoring"
weight = 3
+++

# Layout Model

There are two types of device, communal & personal. There can be multiple communal devices (typically TVs) and multiple personal devices (tablets, phones) participating in a context (a household).

Devices report their capabilities (including screen resolution, audio etc.) on joining a context. They can optionally define one or more logical regions. The layout service will place components into these regions, and the client can manage presentation of the regions without needing further involvement of the layout service (these would typically be used for UI 'space saving' constructs such as drawers, tabs etc). Components can be given a prioritised list of target logical region constraints, if none is given then they can be placed on any of the device’s logical regions.

A DMApp has a layout document that specifies layout constraints for each component that has been defined in the corresponding timeline document.

For each component, constraints are defined for presentation on communal & personal devices respectively. These constraints are effectively independent.

For layout, communal devices are treated as a group, (and only one instance of each component will be laid out across this group) whilst personal devices may have a component instance each.

The per device-type / per component constraints include a priority. When layout is calculated for a device, we sort the components by priority and then look for space to allocate to them (so highest priority is more likely to be laid out). Setting priority to zero will exclude a component from layout. There is currently no mechanism for falling back ‘personal only’ components onto communal devices if there is no personal device available (we may support this in future if required).

When authoring a layout document, here are some points to consider:

What overall layout model do you want to adopt?

* Dynamic – this dynamically subdivides the available screen space/region to accommodate components, components will grow to fill available space, and won’t be placed if space is < minSize. Components are placed in order of priority; high -> low. It also supports prefSize constraints, which the layout service will try to honour where specified. For prefSize, height & width can be specified as numeric pixel dimensions, or string percentage values (percentage of device and/or region size). Dynamic mode supports logical regions.
* Templated – this uses a set of region definitions (defined in screen co-ords 0.0 – 1.0) for each device-type (portrait & landscape definitions)…

For all components – what is their relative importance? Try and rank them…

For each component on the timeline, you should consider the following, as it would affect the presentation on communal & personal devices…

* What device capabilities does this need…?
 * Audio
 * Touch interaction
* What is the minimum presentation size? (in pixels)
* What is the preferred presentation size? (in pixels)
* Does it have a fixed aspect ratio? (e.g. video)
* Do I want margins?
* Do I want to set an position anchor? (dynamic only)
* Do I have any dependencies on other components?
* Do I have any dependencies on other components on the same device?
* Assign priority (high value = higher priority, 0 won’t lay out

From this you should be able to author a set of per component constraints, for presentation on communal & personal devices.

# Note That:

* Note that users will be able to override priorities, and if you set a priority to 0 it will not be laid (until overridden)
* We have defined json schema for the layout docs which can be used to validate docs. The layout service repo includes a standalone validator in the /validate folder.
* The layout service will generate a warning if an ‘unknown’ component (i.e. one that was not declared in the layout doc is run. In this situation the service assume as set of fairly relaxed constraints, so the component will likely layout, but may not run as expected. This is usually down to a mismatch between component ids in timeline & layout docs.
 * You can find these easily for the service instance on mantl by going to: https://platform.2immerse.eu/kibana/app/kibana?#/discover and using the filter:  rawmessage:”/^2-Immerse/” AND source:”LayoutService” AND level:”WARNING”

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
