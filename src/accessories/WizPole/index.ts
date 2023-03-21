import { Device } from '../../types';
import WizBulb from '../WizBulb';

class WizPole extends WizBulb {
  static is = (device: Device) =>
    ["DHRGB"].some((id) => device.model.includes(id));
  static getName = ({ model }: Device) => {
    if (model.includes("DHRGB")) {
      return "Light Pole";
    }
    return "Unknown accessory";
  };
};

export default WizPole;