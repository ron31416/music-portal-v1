// Augment OSMD so TS knows about the Zoom property that exists at runtime.
import "opensheetmusicdisplay";

declare module "opensheetmusicdisplay" {
  interface OpenSheetMusicDisplay {
    /** 1 = 100% scale. Undocumented in types; present on the instance at runtime. */
    Zoom?: number;
  }
}
