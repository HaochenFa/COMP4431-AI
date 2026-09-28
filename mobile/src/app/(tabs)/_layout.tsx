import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { StyleSheet, View } from 'react-native';

import { Icon, Press, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';

// Native Liquid Glass tab bar, monochrome. "Ask Trailhead" floats above it on every tab (bottom accessory),
// so the agent is one tap away while browsing. The bar never minimises: a collapsed bar hides the Trails tab.
export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <NativeTabs tintColor={c.text} minimizeBehavior="never">
      <NativeTabs.BottomAccessory>
        <AskAccessory />
      </NativeTabs.BottomAccessory>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'mountain.2', selected: 'mountain.2.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trails">
        <NativeTabs.Trigger.Label>Trails</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function AskAccessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const inline = placement === 'inline';
  return (
    <View style={[styles.ask, inline && styles.askInline]}>
      <Press onPress={() => router.push('/chat')} style={styles.askText} accessibilityRole="button" accessibilityLabel="Ask Trailhead">
        <Icon name="bubble.left.and.text.bubble.right" size={inline ? 15 : 17} color="text2" />
        <T v={inline ? 'subhead' : 'body'} color="text2" numberOfLines={1}>
          Ask Trailhead
        </T>
      </Press>
      <Press onPress={() => router.push({ pathname: '/chat', params: { listen: '1' } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Talk to Trailhead">
        <Icon name="mic.fill" size={inline ? 16 : 18} color="text" />
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  askInline: { paddingHorizontal: 12 },
  askText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
});
