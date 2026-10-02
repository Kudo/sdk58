import React from 'react';
import {Text} from 'react-native';
import {NitroModules} from 'react-native-nitro-modules';
NitroModules.createHybridObject('UnconfiguredNitroObject');
export default function MissingObject() { return <Text>Should not render</Text>; }
