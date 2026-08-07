/**
 * @typedef {{id:string,path:string,title:string}} StudioView
 * @typedef {{projectId:string,workspaceId:string,roomId:string,designPath:string,relativePath?:string,pathKind:"file"|"folder",entryViews:StudioView[],defaultViewId:string,headVersionId:string|null,updatedAt?:string}} StudioProject
 * @typedef {{versionId:string}} StudioVersion
 * @typedef {{project:StudioProject,effectiveDesignPath?:string,version?:StudioVersion,headVersion?:StudioVersion,currentHashes?:Record<string,string>,views?:StudioView[],previewUrl?:string,eventsUrl?:string,activeIteration?:{status:string,taskId?:string,error?:string}}} StudioProjectResponse
 */

/** @type {{project:StudioProject|null, effectiveDesignPath:string, version:StudioVersion|null, views:StudioView[], selectedViewId:string, previewNonce:number, loading:boolean, saving:boolean, iterating:boolean, error:string, stale:string, editor:{path:string,content:string,baseVersionId:string,sha256:string,dirty:boolean,loaded:boolean}, prompt:string, iterationStatus:string, popout:boolean}} */
export const studio = {
  project: null,
  effectiveDesignPath: "",
  version: null,
  views: [],
  selectedViewId: "",
  previewNonce: 0,
  loading: false,
  saving: false,
  iterating: false,
  error: "",
  stale: "",
  editor: { path: "", content: "", baseVersionId: "", sha256: "", dirty: false, loaded: false },
  prompt: "",
  iterationStatus: "idle",
  popout: false,
};

/** @param {StudioProjectResponse} body */
export function applyStudioProject(body) {
  studio.project = body.project;
  studio.effectiveDesignPath = body.effectiveDesignPath ?? studio.effectiveDesignPath;
  studio.version = body.version ?? body.headVersion ?? studio.version;
  studio.views = body.views ?? body.project.entryViews ?? [];
  studio.selectedViewId = studio.selectedViewId || body.project.defaultViewId || studio.views[0]?.id || "";
  studio.iterationStatus = body.activeIteration?.status ?? studio.iterationStatus;
  studio.error = "";
}

export function selectedStudioView() {
  return studio.views.find((view) => view.id === studio.selectedViewId) ?? studio.views[0] ?? null;
}

export function studioPreviewUrl() {
  if (!studio.project) return "";
  const view = selectedStudioView();
  if (!view) return "";
  return `/api/studio/projects/${encodeURIComponent(studio.project.projectId)}/preview/${encodeURIComponent(view.id)}?v=${studio.previewNonce}`;
}
