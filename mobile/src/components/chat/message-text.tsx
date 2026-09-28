import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';

/** The agent's prose with the little markdown models use: **bold**, bullet and numbered lists, short headings. */
export function MessageText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) return;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) {
      blocks.push(
        <T key={i} v="headline" style={styles.heading}>
          {inline(m[1])}
        </T>,
      );
    } else if ((m = line.match(/^\s*(?:[-*•])\s+(.*)$/))) {
      blocks.push(<Bullet key={i} mark="•" text={m[1]} />);
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      blocks.push(<Bullet key={i} mark={`${m[1]}.`} text={m[2]} />);
    } else {
      blocks.push(
        <T key={i} v="body">
          {inline(line)}
        </T>,
      );
    }
  });
  return <View style={styles.wrap}>{blocks}</View>;
}

function Bullet({ mark, text }: { mark: string; text: string }) {
  return (
    <View style={styles.bullet}>
      <T v="body" color="text2" style={styles.mark}>
        {mark}
      </T>
      <T v="body" style={styles.shrink}>
        {inline(text)}
      </T>
    </View>
  );
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <T key={i} v="body" weight="600">
        {part.slice(2, -2)}
      </T>
    ) : (
      part.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,;:!?])/g, '$1$2') // drop single-asterisk emphasis
    ),
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  heading: { marginTop: 4 },
  bullet: { flexDirection: 'row', gap: 8, paddingLeft: 2 },
  mark: { minWidth: 14, fontVariant: ['tabular-nums'] },
  shrink: { flexShrink: 1 },
});
