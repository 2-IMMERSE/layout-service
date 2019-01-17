+++
title = "Push Message Format"
weight = 3
+++
Version 3

## Overview

Various API calls / interactions will result in the layout service evaluating a new layout for a context (and the DMApp(s) running in it). When this happens, the layout service needs to push a notification to each of the affected clients, so that they can update their presentation accordingly.

The API calls that will result in a new layout evaluation are:

* from a Timeline Service instance:
 * start DMApp component
 * stop DMApp component

*N.B. calls to init DMApp component do not trigger a full layout evaluation - see create message below*

* from a client device
 * hide DMApp component
 * show DMApp component
 * move DMApp component
 * change device orientation
 * join context
 * leave context

## Basic requirements

To push 'instructions' to the client(s) about what they need to do to manage DMApp components, that are

* simple for the client to process
* minimise the need for the layout service to track client state
* Reuse JSON schema objects for DMApp components from REST API RAML spec.

## Messages

In essence we can distill this down to 3 types of action for one or more DMApp components:

* create (what, and optionally, where & when)
* destroy (what, and optionally whether to save state for a move)
* update (what, and partial where / when)

And a further action for managing logical region size changes instigated by the layout service

* logicalRegionChange (new dimensions for resizable logical region)

where:
* 'what' will include a unique DMApp component reference (i.e. a contextId/DMAppId/componentId triple),
and may include config information including if state needs to be saved or restored
* 'where' will include device / layout information
* 'when' will include start or stop time i.e. when the change should be enacted.

*N.B.*
* Each message has a sequential messageId to make it easy to track / debug, and also to allow clients to acknowledge receipt / action of messages using status calls...
* Each message has a timestamp, this gives a server timestamp of when the layout that resulted in this message was evaluated (one layout evaluation may result in several push messages to different devices, but they will each have the same timestamp).
* Each message can address a list of DMApp components.
* A component move is handled as a destroy on the old device (optionally saving component state), and a create on the new device (optionally restoring component state)
* These messages will be sent from layout service to clients using the websocket service: https://2immerse.eu/wiki/websocket-service/

### Create
```json{
  "create": {
    "messageId": 1,
    "timestamp": 1473264278231,
    "deviceId": "dev0",
    "components": [ {
      "componentId": "1",
      "DMAppId": "200",
      "contextId": "0",
      "config": {
        "class": "dashvideoplayer",
        "url": "2-immerse.eu/mydmapp/videoplayer",
        "restoreState": true
      },
      "startTime": null,
      "stopTime": null,
      "layout": null
    },
    {
      "componentId": "2",
      ...
    } ]
  }
}
```
This message is sent whenever a timeline service instance calls 'init DMApp component', or as part of a component move sequence.

In the case where a timeline service instance calls 'init DMApp component':
A 'pre-layout' is performed, this simply identifies which of the devices the component could run on, and a create message is sent to each of the devices to allow them to speculatively pre-load the component, using the information in the config child object. startTime, stopTime & layout attributes will be null.

In the case where this happens as part of a component move sequence: startTime & layout attributes will be fully populated. If a config.restoreUrl attribute is provided, the client should restore component state from this API endpoint.

### Destroy
```json{
  "destroy": {
    "messageId": 2,
    "timestamp": 1473264278731,
    "deviceId": "dev0",
    "components": [{
      "componentId": "2",
      "DMAppId": "200",
      "contextId": "0",
      "config": {
        "saveState": true
      },
      "stopTime": 56.2
    },
    {
      "messageId": 2,
      ...
    } ]
  }
}
```
This message is sent whenever a timeline service instance calls 'stop DMApp component', or as part of a component move sequence.

At the specified stopTime, the component should be removed. If a config.saveUrl attribute is provided , the client should save component state to this API endpoint.

### Update
```json{
  "update": {
    "messageId": 3,
    "timestamp": 1473264279231,
    "deviceId": "dev0",
    "components": [{
      "componentId": "1",
      "DMAppId": "200",
      "contextId": "0",
      "startTime": 34.3,
      "layout": {
        "position": {
          "x": 5,
          "y": 5
        },
        "size": {
          "width": 800,
          "height": 500
        },
        "zdepth": 0,
        "deviceId": "1238",
        "regionId": "region1"
      }
    },{
      "componentId": "2",
      ...
    }]
  }
}
```
This message is sent whenever layout for an existing component changes (typically position, size or zdepth), or a component is hidden / shown under user control (via a client device).
The presentation should be updated at the specified startTime.
When a component is hidden, the update message layout.position child object will be set to null, and when it is re-shown it will contain a fully specified position. deviceId will not change on an update message, since this is handled through a component move sequence.

### logicalRegionChange
```json{
  "logicalRegionChange": {
    "messageId": 39,
    "timestamp": 1473864219231,
    "deviceId": "dev0",
    "logicalRegions": [{
      "regionId": "region1",
      "displayWidth": 480,
      "displayHeight": 360,
      "resizable": true
    },{
      "regionId": "region2",
      "displayWidth": 240,
      "displayHeight": 180,
      "resizable": true
    }]
  }
}
```
This message is sent whenever the layout service resizes one or more 'resizable' logical regions (i.e. regions created by the client device for which the  which the "resizable" property is true), signaling the change to the client device to which the logical regions belong.

## Implementation Considerations

In an optimal implementation, push messages will only be sent to devices that are hosting the component which is the subject of the message. However, clients should not assume this to always be the case (i.e. they may receive message about components they do not host).

The timeline service will preferably send component start & stop messages just ahead of time i.e. giving enough time to evaluate layout and push the resulting messages to affected clients. Calculating layouts and pushing messages to clients a long time in advance will require a significantly more complex state management implementation in the layout service, and possibly require that the layout service tracks timeline; neither is desirable as they bring complexity to the design and implementation.

In a situation where multiple components are started / stopped at the same time, there may be value in a 'batch' or 'list' style call where start or stop times can be set for multiple components in a single call. Without this we will end up sequentially iterating a layout, with each iteration resulting in a set of transient push messages. It would be cleaner and simpler to evaluate the layout start / stop times are know for all the affected components.