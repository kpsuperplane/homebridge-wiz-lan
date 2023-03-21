import {
  API
} from "homebridge";
import { PLUGIN_NAME } from "./constants";
import HomebridgeWizLan from "./wiz";

export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, HomebridgeWizLan as any);
};