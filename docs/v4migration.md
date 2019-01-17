+++
title = "V3 - V4 Migration Guide"
weight = 3
+++
Version 4

## Overview

The Layout Service has recently migrated from the v3 REST API to the V4 API. Although the changes do not have a substantial impact on the API, there are some non-backward compatible changes, hence raising the API version.

### High level feature changes ###

Constraint management. In version 3, constraints were statically defined in a 'layout document' loaded as part of the DMApp launch process. Constraints were keyed by componentId, which in some cases has led to very repetitive layout documents, with identical constraints for a set of components being duplicated. The only means to change component constraints 'in flight' was through the setPriority call.

In version 4 we have separated components & constraints; constraints are now keyed by a constraintId (so the layout document format has also been revised to version 4 - see below). The transaction API now accepts a list of componentId, constraintId tuples (where constraintId is optional), rather than a list of componentId's; this is where components and constraints are 'bound'. This binding is provided for init transactions, and can be changed using an update transactions, the binding is ignored in all other transaction types. If the optional constraintId is not provided then a default will be used.

There is also a REST API to create, update & delete constraint definitions whilst a DMApp is running.

These mechanisms allow a more dynamic approach to component layout constraints.

### REST API Changes ###

For full details of API changes please refer to the RAML API definition: (../api/layout-service.raml)

Significant changes:

API is now mounted at a v4-specific path

e.g. http://layout-service.platform.2immerse.eu/layout/v4/

/context/{contextId}/dmapp/{dmappId}/transaction

Transaction API POST body has changed so that the component list is now a list of objects that are componentId, constraintId tuples

e.g. 

```json{
	"time": 1505304361,
	"actions": [{
		"action": "init",
		"components": [{
			"componentId": "video-player",
			"constraintId": "constraint-full-screen"
		}]
	}, {
		"action": "start",
		"components": [{
			"componentId": "video-player",
			"constraintId": "constraint-full-screen"
		}]
	}]
}
```


### Push Message Changes ###

~~Create/Destroy/Update push message startTime and stopTime properties will now be set to -1 when undefined (rather than null as previously)~~

This change has been reverted and startTime and stopTime properties will now be set to null when undefined as previously.

### Layout Document Changes ###

The minimum changes to a layout document to become v4 schema compliant are:

* version has been raised to 4
* 'componentId' properties need to be changed to 'constraintId'

The full schema is available: (../api/v4-document-schema.json). Please note the binding between componentIds & constraintIds is managed through the transaction API as described above.

## Licensing
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