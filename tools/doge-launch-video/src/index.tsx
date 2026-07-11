import {Composition} from 'remotion';
import {registerRoot} from 'remotion';
import {DogeCommerceLaunch} from './LaunchVideo';

export const RemotionRoot = () => (
  <Composition
    id="DogeCommerceLaunch"
    component={DogeCommerceLaunch}
    durationInFrames={1440}
    fps={30}
    width={1920}
    height={1080}
  />
);

registerRoot(RemotionRoot);
