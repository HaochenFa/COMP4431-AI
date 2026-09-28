import { Stack } from 'expo-router';

import { useTheme } from '@/constants/theme';

export default function TrailsLayout() {
  const { c } = useTheme();
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Trails', headerLargeTitle: true, headerTransparent: true, headerLargeTitleShadowVisible: false }} />
    </Stack>
  );
}
