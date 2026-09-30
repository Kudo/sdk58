/**
 * Replacement for react-native-gesture-handler's native
 * `src/v3/detectors/HostGestureDetector` (aliased in src/bundle.ts).
 *
 * Renders the real `RNGestureHandlerDetector` native component with the same
 * props, so the tree has the same shape as on a device, and does what the
 * native detector view does on Android: attach each handler in
 * `handlerTags` to the detector view, or to its single child for handlers
 * that attach to the child view (Native gestures, e.g. buttons). The
 * handlers then report through Fabric events on the detector element.
 */

import * as React from 'react';
import {useEffect, useImperativeHandle, useRef} from 'react';
import {ActionType} from 'react-native-gesture-handler/src/ActionType';
import RNGestureHandlerDetectorNativeComponent from 'react-native-gesture-handler/src/specs/RNGestureHandlerDetectorNativeComponent';
import NodeManager from 'react-native-gesture-handler/src/web/tools/NodeManager';

import {attachToElement} from './NativeRNGestureHandlerModule';

export default function HostGestureDetector({ref, ...props}) {
  const detectorRef = useRef(null);
  useImperativeHandle(ref, () => detectorRef.current, []);
  const handlerTags = props.handlerTags ?? [];
  const tagsKey = handlerTags.join(',');

  useEffect(() => {
    const owner = {};
    const attached = new Set();
    for (const tag of handlerTags) {
      NodeManager.observeHandler(tag, owner, handler => {
        const detector = detectorRef.current;
        if (detector == null || attached.has(tag)) return;
        let view = detector;
        if (handler.shouldAttachGestureToChildView()) {
          if (detector.childElementCount !== 1) return;
          view = detector.firstElementChild;
        }
        attachToElement(tag, view, ActionType.NATIVE_DETECTOR, detector);
        attached.add(tag);
      });
    }
    return () => {
      NodeManager.cancelAllObservationsForOwner(owner);
      for (const tag of attached) {
        NodeManager.detachGestureHandler(tag);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagsKey]);

  return <RNGestureHandlerDetectorNativeComponent ref={detectorRef} {...props} />;
}
