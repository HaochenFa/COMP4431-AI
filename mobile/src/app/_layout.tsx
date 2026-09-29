import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useTheme } from '@/constants/theme';
import { AgentProvider } from '@/lib/agent';
import { RecentProvider } from '@/lib/recent';
import { SettingsProvider } from '@/lib/settings';
import { useSpeakOutcomes } from '@/lib/speech';
import { TrailsProvider } from '@/lib/trails';

// Tabs (Plan home, Trails) at the root; the chat, plan, trail and map pages push over them full screen.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <RecentProvider>
          <AgentProvider>
            <TrailsProvider>
              <Navigator />
            </TrailsProvider>
          </AgentProvider>
        </RecentProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}

function Navigator() {
  const { c, dark } = useTheme();
  useSpeakOutcomes();
  const base = dark ? DarkTheme : DefaultTheme;
  // Chrome stays monochrome (HIG); lime is kept for "go", primary actions and the route.
  const nav = { ...base, colors: { ...base.colors, primary: c.text, background: c.bg, card: c.bg, text: c.text, border: c.separator } };
  const overContent = { headerShown: true, headerTransparent: true, title: '', headerBackButtonDisplayMode: 'minimal' } as const;
  return (
    <ThemeProvider value={nav}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="chat"
          options={{ headerShown: true, headerShadowVisible: false, headerStyle: { backgroundColor: c.bg }, headerBackButtonDisplayMode: 'minimal' }}
        />
        <Stack.Screen name="plan/[id]" options={overContent} />
        <Stack.Screen name="trail/[id]" options={overContent} />
        <Stack.Screen name="map" options={overContent} />
        <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: true, title: 'Settings' }} />
      </Stack>
    </ThemeProvider>
  );
}
