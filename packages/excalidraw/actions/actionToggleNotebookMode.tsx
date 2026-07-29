import { CaptureUpdateAction } from "@excalidraw/element";

import { gridIcon } from "../components/icons";

import { register } from "./register";

export const actionToggleNotebookMode = register({
  name: "notebookMode",
  icon: gridIcon,
  keywords: ["notebook", "grid"],
  label: "labels.toggleNotebookMode",
  viewMode: true,
  trackEvent: {
    category: "canvas",
    predicate: (appState) => appState.gridType === "notebook",
  },
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        gridModeEnabled: true,
        gridType: "notebook",
        objectsSnapModeEnabled: false,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  checked: (appState) => appState.gridType === "notebook",
  predicate: (element, appState, props) => {
    return true;
  },
});
