import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/constants/theme';

// The Trailhead mark: two peaks, and the trail winding up into the saddle between them (cut out, so any
// background shows through). Same geometry as the app icon (assets/app.icon, assets/images/icon.svg).
const D =
  'M453.1 782.0 L461.2 763.6 L470.7 747.4 L485.2 727.5 L517.4 688.6 L523.7 678.6 L527.6 668.0 L527.9 655.2 L523.4 639.6 L516.1 626.0 L499.9 603.8 L493.2 592.8 L488.2 580.1 L486.0 567.5 L486.0 558.6 L487.3 548.7 L493.7 528.8 L497.9 522.8 L501.6 519.6 L508.1 516.3 L515.4 515.0 L522.6 515.9 L529.4 518.9 L534.9 523.7 L538.8 529.8 L540.4 534.5 L540.9 541.8 L536.3 558.6 L536.4 566.8 L540.3 574.3 L559.3 600.6 L568.4 617.7 L573.0 629.9 L576.4 642.5 L578.4 662.0 L577.4 673.8 L574.5 686.2 L570.0 697.6 L564.4 708.0 L551.5 726.3 L520.1 764.0 L508.1 782.0 L848.0 782.0 L856.8 780.7 L864.9 776.8 L869.4 773.0 L874.7 765.7 L876.9 760.2 L878.0 751.3 L877.3 745.4 L874.0 737.1 L662.0 367.1 L656.5 360.1 L649.3 355.1 L640.8 352.4 L629.1 352.8 L620.8 356.1 L613.9 361.7 L521.8 483.8 L421.5 331.0 L414.5 325.7 L403.4 322.2 L391.8 323.2 L381.4 328.5 L373.8 337.3 L149.8 737.3 L146.2 748.6 L147.2 760.4 L152.7 770.8 L161.7 778.4 L173.0 781.9 Z';

/** The mark in accent lime (or any theme colour), `size` points wide. */
export function Logo({ size = 40, color }: { size?: number; color?: string }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={(size * 460.0) / 732.0} viewBox="146.0 322.0 732.0 460.0" accessibilityLabel="Trailhead">
      <Path d={D} fill={color ?? c.accent} fillRule="evenodd" />
    </Svg>
  );
}
