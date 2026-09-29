import { useEffect, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Glass, Icon, Press, T } from '@/components/ui';
import { useTheme } from '@/constants/theme';
import { useVoice } from '@/lib/voice';

/**
 * Glass capsule: type, or tap the mic to talk. While listening it becomes the voice bar
 * (live level + transcript; ✕ discards, ↑ sends). The send button replaces the mic once there is text.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onVoice,
  placeholder,
  disabled,
  listenOnMount,
  autoFocus,
}: {
  value: string;
  onChange: (t: string) => void;
  onSend: () => void;
  onVoice: (text: string) => void;
  placeholder: string;
  disabled?: boolean;
  listenOnMount?: boolean;
  autoFocus?: boolean;
}) {
  const { c, dark } = useTheme();
  const voice = useVoice({ onFinal: onVoice });
  const started = useRef(false);

  useEffect(() => {
    if (listenOnMount && !disabled && !started.current) {
      started.current = true;
      voice.start();
    }
  }, [listenOnMount, disabled, voice]);

  if (voice.listening) {
    return (
      <Glass style={styles.bar}>
        <Press onPress={voice.cancel} style={[styles.round, { backgroundColor: c.surface2 }]} accessibilityLabel="Discard what I said">
          <Icon name="xmark" size={15} weight="semibold" color="text2" />
        </Press>
        <View style={styles.voice}>
          <Level level={voice.level} />
          <T v="body" color={voice.transcript ? 'text' : 'text2'} numberOfLines={3} style={styles.shrink}>
            {voice.transcript || 'Listening…'}
          </T>
        </View>
        <Press onPress={voice.finish} style={[styles.round, { backgroundColor: c.accent }]} accessibilityLabel="Send what I said">
          <Icon name="arrow.up" size={17} weight="bold" color="onAccent" />
        </Press>
      </Glass>
    );
  }

  const hasText = Boolean(value.trim());
  return (
    <Glass style={styles.bar} interactive>
      <TextInput
        style={[styles.input, { color: c.text }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.text3}
        multiline
        submitBehavior="submit"
        returnKeyType="send"
        onSubmitEditing={() => hasText && onSend()}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardAppearance={dark ? 'dark' : 'light'}
        selectionColor={c.accentInk}
      />
      {hasText ? (
        <Press onPress={onSend} disabled={disabled} style={[styles.round, { backgroundColor: c.accent }]} accessibilityLabel="Send">
          <Icon name="arrow.up" size={17} weight="bold" color="onAccent" />
        </Press>
      ) : (
        <Press onPress={() => voice.start()} disabled={disabled} style={[styles.round, { backgroundColor: c.surface2 }, disabled && styles.off]} accessibilityLabel="Talk to Trailhead">
          <Icon name="mic.fill" size={17} color="text" />
        </Press>
      )}
    </Glass>
  );
}

const BARS = [0.55, 0.85, 1, 0.75, 0.5];

function Level({ level }: { level: number }) {
  return (
    <View style={styles.level} accessibilityElementsHidden>
      {BARS.map((k, i) => (
        <Bar key={i} target={4 + level * 18 * k} />
      ))}
    </View>
  );
}

function Bar({ target }: { target: number }) {
  const { c } = useTheme();
  const h = useSharedValue(4);
  useEffect(() => {
    h.value = withTiming(target, { duration: 90 });
  }, [target, h]);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[styles.levelBar, { backgroundColor: c.accent }, style]} />;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 6, borderRadius: 26, minHeight: 52 },
  input: { flex: 1, fontSize: 17, lineHeight: 22, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, maxHeight: 132 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.4 },
  voice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 4 },
  shrink: { flexShrink: 1 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 24 },
  levelBar: { width: 3, borderRadius: 2 },
});
