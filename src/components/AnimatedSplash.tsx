import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import Svg, { Rect, Path, Circle, Polygon } from 'react-native-svg';

interface Props {
  onFinish: () => void;
}

export function AnimatedSplash({ onFinish }: Props) {
  // Core animation values
  const bgOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.72);
  const logoOpacity = useSharedValue(0);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkY = useSharedValue(16);
  const dividerScaleX = useSharedValue(0);
  const taglineOpacity = useSharedValue(0);
  const screenOpacity = useSharedValue(1);

  // Water dot scales — one per dot
  const d1 = useSharedValue(1);
  const d2 = useSharedValue(1);
  const d3 = useSharedValue(1);
  const d4 = useSharedValue(1);
  const d5 = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const breathe = (sv: ReturnType<typeof useSharedValue>, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1.6, { duration: 1000, easing: Easing.inOut(Easing.sin) }),
            withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.sin) })
          ),
          -1,
          false
        )
      );
    };

    // 1. Background fades in
    bgOpacity.value = withTiming(1, { duration: 350, easing: ease });

    // 2. Icon block springs in
    logoOpacity.value = withDelay(180, withTiming(1, { duration: 420 }));
    logoScale.value = withDelay(180, withSpring(1, { mass: 1, damping: 16, stiffness: 110 }));

    // 3. Wordmark drifts up
    wordmarkOpacity.value = withDelay(620, withTiming(1, { duration: 450 }));
    wordmarkY.value = withDelay(620, withTiming(0, { duration: 450, easing: ease }));

    // 4. Divider expands
    dividerScaleX.value = withDelay(820, withTiming(1, { duration: 380, easing: ease }));

    // 5. Tagline fades in
    taglineOpacity.value = withDelay(1050, withTiming(1, { duration: 450 }));

    // 6. Water dots breathe (staggered)
    breathe(d1, 1100);
    breathe(d2, 1250);
    breathe(d3, 1400);
    breathe(d4, 1250);
    breathe(d5, 1100);

    // 7. Fade out entire screen
    screenOpacity.value = withDelay(
      2800,
      withTiming(0, { duration: 500, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      })
    );
  }, []);

  const bgStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkY.value }],
  }));
  const dividerStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: dividerScaleX.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));
  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));

  const dot1Style = useAnimatedStyle(() => ({ transform: [{ scale: d1.value }] }));
  const dot2Style = useAnimatedStyle(() => ({ transform: [{ scale: d2.value }] }));
  const dot3Style = useAnimatedStyle(() => ({ transform: [{ scale: d3.value }] }));
  const dot4Style = useAnimatedStyle(() => ({ transform: [{ scale: d4.value }] }));
  const dot5Style = useAnimatedStyle(() => ({ transform: [{ scale: d5.value }] }));

  const dotStyles = [dot1Style, dot2Style, dot3Style, dot4Style, dot5Style];
  const dotOpacities = [0.5, 0.35, 0.5, 0.35, 0.5];

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, styles.screen, screenStyle]}>
      {/* Gradient background */}
      <Animated.View style={[StyleSheet.absoluteFillObject, styles.bg, bgStyle]} />

      {/* Center content */}
      <View style={styles.center}>

        {/* Icon block */}
        <Animated.View style={logoStyle}>
          <Svg width={176} height={152} viewBox="88 28 224 194">
            {/* Rounded square */}
            <Rect x="90" y="30" width="220" height="190" rx="44" fill="#1B6CA8" />

            {/* Outer glow ring (soft) */}
            <Rect x="86" y="26" width="228" height="198" rx="48" fill="none"
              stroke="#4AACCF" strokeWidth="2" opacity="0.18" />

            {/* Zen arc top-right */}
            <Path
              d="M274,44 A44,44 0 0,1 316,86"
              stroke="#4AACCF" strokeWidth="5" fill="none"
              strokeLinecap="round" opacity="0.75"
            />
            <Circle cx="316" cy="86" r="8" fill="#74C69D" />

            {/* R mark */}
            <Path
              d="M108,58 L108,204 L130,204 L130,158 L158,158 L182,204 L208,204 L182,152
                 C196,142 204,128 204,110 C204,86 188,66 162,66 Z
                 M130,86 L160,86 C172,86 180,93 180,103 C180,113 172,120 160,120 L130,120 Z"
              fill="white"
            />
            <Polygon points="136,120 108,154 136,154 164,120" fill="#1B6CA8" />
            <Polygon points="126,158 112,192 148,168" fill="white" opacity="0.92" />

            {/* Z mark */}
            <Path
              d="M218,66 L218,90 L278,90 L218,166 L218,204 L304,204 L304,180
                 L244,180 L304,104 L304,66 Z"
              fill="white" strokeLinejoin="round"
            />
            <Polygon points="278,66 304,66 304,90 284,88" fill="#1B6CA8" />
            <Polygon points="218,166 208,196 244,180" fill="white" opacity="0.9" />
            <Polygon points="292,66 304,66 304,78" fill="#4AACCF" opacity="0.75" />
          </Svg>
        </Animated.View>

        {/* Wordmark */}
        <Animated.Text style={[styles.wordmark, wordmarkStyle]}>
          RideZen
        </Animated.Text>

        {/* Divider */}
        <Animated.View style={[styles.divider, dividerStyle]} />

        {/* Tagline */}
        <Animated.Text style={[styles.tagline, taglineStyle]}>
          STOP REMEMBERING. START RIDING.
        </Animated.Text>

        {/* Water dots */}
        <View style={styles.dotsRow}>
          {dotStyles.map((style, i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                { opacity: dotOpacities[i] },
                style,
              ]}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    zIndex: 999,
  },
  bg: {
    backgroundColor: '#0D3B5E',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  wordmark: {
    fontFamily: 'PlayfairDisplay_500Medium',
    fontSize: 38,
    color: '#F0F8FF',
    letterSpacing: 2,
    marginTop: 24,
  },
  divider: {
    width: 200,
    height: 1.5,
    backgroundColor: '#4AACCF',
    opacity: 0.45,
    marginTop: 12,
  },
  tagline: {
    fontFamily: 'Inter_300Light',
    fontSize: 10,
    color: '#A8C8E0',
    letterSpacing: 2.5,
    marginTop: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 48,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#4AACCF',
    marginHorizontal: 5,
  },
});
