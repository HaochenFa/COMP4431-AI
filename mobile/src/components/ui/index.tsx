// Primitives every screen is built from. Hierarchy comes from type and surface steps, not borders.
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol, type SymbolType, type SymbolWeight } from 'expo-symbols';
import { Children, Fragment, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { radius, type, useTheme, type Colors, type TypeVariant } from '@/constants/theme';

type ColorName = keyof Colors;
const pick = (c: Colors, color: ColorName | string) => (color in c ? c[color as ColorName] : color);

export function T({
  v = 'body',
  color = 'text',
  weight,
  center,
  style,
  ...rest
}: TextProps & { v?: TypeVariant; color?: ColorName | string; weight?: TextStyle['fontWeight']; center?: boolean }) {
  const { c } = useTheme();
  return <Text {...rest} style={[type[v], { color: pick(c, color) }, weight && { fontWeight: weight }, center && styles.center, style]} />;
}

export function Icon({
  name,
  size = 20,
  color = 'text',
  weight,
  mode,
}: {
  name: SFSymbol;
  size?: number;
  color?: ColorName | string;
  weight?: SymbolWeight;
  mode?: SymbolType;
}) {
  const { c } = useTheme();
  return <SymbolView name={name} size={size} tintColor={pick(c, color)} weight={weight} type={mode} style={{ width: size, height: size }} />;
}

/** Pressable with the iOS dim-on-press feedback. */
export function Press({ style, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <Pressable {...rest} style={({ pressed }) => [style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

/** Liquid Glass for controls and navigation only (HIG), with a flat fallback before iOS 26. */
export function Glass({ style, children, interactive }: { style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean }) {
  const { c } = useTheme();
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView style={style} isInteractive={interactive}>
        {children}
      </GlassView>
    );
  }
  return <View style={[{ backgroundColor: c.surface2 }, style]}>{children}</View>;
}

/** A round Liquid Glass button, the same material as the native header buttons (back, toolbar). */
export function GlassButton({
  icon,
  onPress,
  accessibilityLabel,
  size = 44,
  style,
}: {
  icon: SFSymbol;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} hitSlop={6} style={style}>
      <Glass interactive style={[styles.glassButton, { width: size, height: size, borderRadius: size / 2 }]}>
        <Icon name={icon} size={Math.round(size * 0.42)} weight="medium" color="text" />
      </Glass>
    </Pressable>
  );
}

/** Search as a Liquid Glass capsule, like the composer: one look whether it's idle, focused or scrolled. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  return (
    <Glass interactive style={[styles.search, style]}>
      <Icon name="magnifyingglass" size={16} weight="medium" color="text2" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.text3}
        style={[styles.searchInput, { color: c.text }]}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        keyboardAppearance={dark ? 'dark' : 'light'}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="xmark.circle.fill" size={17} color="text3" />
        </Pressable>
      ) : null}
    </Glass>
  );
}

export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface }, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <T v="title3" style={styles.flex}>
        {children}
      </T>
      {action}
    </View>
  );
}

/** Inset grouped list, like Settings. `inset` is where the hairline starts (past the icon column). */
export function ListSection({
  title,
  footer,
  inset = 16,
  style,
  children,
}: {
  title?: string;
  footer?: string;
  inset?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { c } = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      <View style={[styles.card, { backgroundColor: c.surface }]}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={[styles.hairline, { backgroundColor: c.separator, marginLeft: inset }]} />}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <T v="footnote" color="text2" style={styles.footer}>
          {footer}
        </T>
      ) : null}
    </View>
  );
}

export function ListRow({
  icon,
  iconColor = 'text2',
  title,
  subtitle,
  value,
  accessory,
  onPress,
  tone,
  titleLines,
  subtitleLines,
  leading,
}: {
  icon?: SFSymbol;
  iconColor?: ColorName | string;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  accessory?: 'chevron' | 'check' | 'link' | ReactNode;
  onPress?: () => void;
  tone?: 'danger' | 'accent';
  titleLines?: number;
  subtitleLines?: number;
  leading?: ReactNode;
}) {
  const body = (
    <View style={styles.row}>
      {leading ?? (icon ? <Icon name={icon} size={20} color={iconColor} /> : null)}
      <View style={styles.flex}>
        <T v="body" color={tone ?? 'text'} numberOfLines={titleLines}>
          {title}
        </T>
        {subtitle ? (
          <T v="footnote" color="text2" numberOfLines={subtitleLines} style={styles.subtitle}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {value != null ? (
        typeof value === 'string' || typeof value === 'number' ? (
          <T v="body" color="text2">
            {value}
          </T>
        ) : (
          value
        )
      ) : null}
      {accessory === 'chevron' ? (
        <Icon name="chevron.right" size={13} weight="semibold" color="text3" />
      ) : accessory === 'check' ? (
        <Icon name="checkmark" size={16} weight="semibold" color="accentInk" />
      ) : accessory === 'link' ? (
        <Icon name="arrow.up.right" size={13} weight="semibold" color="text3" />
      ) : (
        accessory
      )}
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} accessibilityRole="button">
      {body}
    </Press>
  ) : (
    body
  );
}

type Tone = 'neutral' | 'accent' | 'caution' | 'danger' | 'info' | 'glass' | 'stop';

export function Chip({
  label,
  icon,
  tone = 'neutral',
  selected,
  onPress,
  style,
}: {
  label: string;
  icon?: SFSymbol;
  tone?: Tone;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, dark } = useTheme();
  const [bg, fg] = selected
    ? [c.text, c.bg]
    : {
        neutral: [c.surface2, c.text],
        accent: [c.accent, c.onAccent],
        caution: [c.cautionSoft, c.caution],
        danger: [c.dangerSoft, c.danger],
        info: [c.surface2, c.info],
        glass: ['rgba(0,0,0,0.45)', '#FFFFFF'],
        stop: [c.danger, dark ? c.bg : '#FFFFFF'], // solid no-go, legible over photos
      }[tone];
  const content = (
    <>
      {icon ? <Icon name={icon} size={12} weight="semibold" color={fg} /> : null}
      <T v="caption" color={fg} weight="600">
        {label}
      </T>
    </>
  );
  const chipStyle = [styles.chip, { backgroundColor: bg }, style];
  return onPress ? (
    <Press onPress={onPress} style={chipStyle} accessibilityRole="button" accessibilityState={{ selected }}>
      {content}
    </Press>
  ) : (
    <View style={chipStyle}>{content}</View>
  );
}

export function Button({
  title,
  icon,
  variant = 'primary',
  onPress,
  disabled,
  style,
  accessibilityLabel,
}: {
  title?: string;
  icon?: SFSymbol;
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const [bg, fg] = { primary: [c.accent, c.onAccent], secondary: [c.surface2, c.text], ghost: ['transparent', c.accentInk] }[variant];
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={[styles.button, !title && styles.iconButton, { backgroundColor: bg }, disabled && styles.disabled, style]}>
      {icon ? <Icon name={icon} size={17} weight="semibold" color={fg} /> : null}
      {title ? (
        <T v="headline" color={fg}>
          {title}
        </T>
      ) : null}
    </Press>
  );
}

export type Stat = { value: string; unit?: string; label: string };

/** Borderless stats row: value in tabular figures, unit and label smaller. */
export function StatRow({ items, style }: { items: Stat[]; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.stats, style]}>
      {items.map((s, i) => (
        <Fragment key={s.label}>
          {i > 0 && <View style={[styles.statRule, { backgroundColor: c.separator }]} />}
          <View style={styles.stat}>
            <T v="stat" numberOfLines={1}>
              {s.value}
              {s.unit ? (
                <T v="footnote" color="text2" weight="500">
                  {' '}
                  {s.unit}
                </T>
              ) : null}
            </T>
            <T v="caption" color="text2">
              {s.label}
            </T>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

export const hairline = StyleSheet.hairlineWidth;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  glassButton: { alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: 23, paddingHorizontal: 15 },
  searchInput: { flex: 1, fontSize: 17, paddingVertical: 0, height: 46 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.55 },
  card: { borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  hairline: { height: StyleSheet.hairlineWidth },
  footer: { marginTop: 8, marginHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 50 },
  subtitle: { marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
  },
  iconButton: { width: 50, paddingHorizontal: 0 },
  disabled: { opacity: 0.4 },
  stats: { flexDirection: 'row', alignItems: 'stretch' },
  stat: { flex: 1, gap: 2, alignItems: 'center' },
  statRule: { width: StyleSheet.hairlineWidth },
});
