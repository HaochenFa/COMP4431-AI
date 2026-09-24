import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { C } from '@/constants/palette';
import { AgentProvider } from '@/lib/agent';
import { SettingsProvider } from '@/lib/settings';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SettingsProvider>
        <AgentProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.paper } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: true, title: 'Settings' }} />
          </Stack>
        </AgentProvider>
      </SettingsProvider>
    </GestureHandlerRootView>
  );
}
