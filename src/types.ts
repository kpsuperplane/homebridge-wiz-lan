import { PlatformConfig } from "homebridge";

export interface Config extends PlatformConfig {
  port?: number;
  enableScenes?: boolean;
  broadcast?: string;
  address?: string;
  devices?: { host?: string; mac?: string; name?: string }[];
}
export interface Device {
  model: string;
  ip: string;
  mac: string;

  lastSelectedSceneId?: number;
}
