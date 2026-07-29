import { CaptureUpdateAction } from "@excalidraw/element";

import { gridIcon } from "../components/icons";

import { register } from "./register";

export const actionToggleCalligraphyMode = register({
  name: "calligraphyMode",
  icon: gridIcon,
  keywords: ["calligraphy", "grid"],
  label: "labels.toggleCalligraphyMode",
  viewMode: true,
  trackEvent: {
    category: "canvas",
    predicate: (appState) => appState.gridType === "calligraphy",
  },
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        gridModeEnabled: true,
        gridType: "calligraphy",
        objectsSnapModeEnabled: false,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  checked: (appState) => appState.gridType === "calligraphy",
  predicate: (element, appState, props) => {
    return true;
  },
});
