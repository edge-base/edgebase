import type { CSSProperties } from 'react';

type Tone =
  | 'sky'
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'slate'
  | 'cyan'
  | 'orange';

interface PlatformTokenDefinition {
  short: string;
  tone: Tone;
  label?: string;
  logoSrc?: string;
}

const toneStops: Record<Tone, [string, string]> = {
  sky: ['#0ea5e9', '#2563eb'],
  blue: ['#2563eb', '#4f46e5'],
  violet: ['#8b5cf6', '#d946ef'],
  emerald: ['#10b981', '#14b8a6'],
  amber: ['#f59e0b', '#f97316'],
  rose: ['#f43f5e', '#ec4899'],
  slate: ['#475569', '#0f172a'],
  cyan: ['#06b6d4', '#0891b2'],
  orange: ['#f97316', '#ea580c'],
};

const platformDefinitions: Record<string, PlatformTokenDefinition> = {
  JavaScript: { short: 'JS', tone: 'amber', logoSrc: '/img/sdk-logos/javascript-original.svg' },
  Python: { short: 'PY', tone: 'sky', logoSrc: '/img/sdk-logos/python-original.svg' },
  Dart: { short: 'DA', tone: 'cyan', logoSrc: '/img/sdk-logos/dart-original.svg' },
  Swift: { short: 'SW', tone: 'orange', logoSrc: '/img/sdk-logos/swift-original.svg' },
  Kotlin: { short: 'KT', tone: 'violet', logoSrc: '/img/sdk-logos/kotlin-original.svg' },
  Java: { short: 'JV', tone: 'rose', logoSrc: '/img/sdk-logos/java-original.svg' },
  Scala: { short: 'SC', tone: 'rose', logoSrc: '/img/sdk-logos/scala-original.svg' },
  Go: { short: 'GO', tone: 'cyan', logoSrc: '/img/sdk-logos/go-original.svg' },
  PHP: { short: 'PHP', tone: 'violet', logoSrc: '/img/sdk-logos/php-original.svg' },
  Rust: { short: 'RS', tone: 'orange', logoSrc: '/img/sdk-logos/rust-original.svg' },
  'C#': { short: 'C#', tone: 'violet', logoSrc: '/img/sdk-logos/csharp-original.svg' },
  'C++': { short: 'C++', tone: 'blue', logoSrc: '/img/sdk-logos/cplusplus-original.svg' },
  Ruby: { short: 'RB', tone: 'rose', logoSrc: '/img/sdk-logos/ruby-original.svg' },
  Elixir: { short: 'EX', tone: 'violet', logoSrc: '/img/sdk-logos/elixir-original.svg' },
  Unity: { short: 'U', tone: 'slate', logoSrc: '/img/sdk-logos/unity-original.svg' },
  Unreal: {
    short: 'UE',
    tone: 'slate',
    label: 'Unreal',
    logoSrc: '/img/sdk-logos/unrealengine-original.svg',
  },
  'React Native': { short: 'RN', tone: 'sky', logoSrc: '/img/sdk-logos/react-original.svg' },
  Flutter: { short: 'FL', tone: 'cyan', logoSrc: '/img/sdk-logos/flutter-original.svg' },
  Android: { short: 'AN', tone: 'emerald', logoSrc: '/img/sdk-logos/android-original.svg' },
  iOS: { short: 'iOS', tone: 'slate', logoSrc: '/img/sdk-logos/apple-original.svg' },
  macOS: { short: 'mac', tone: 'slate', logoSrc: '/img/sdk-logos/apple-original.svg' },
  Web: { short: 'WEB', tone: 'blue', logoSrc: '/img/sdk-logos/chrome-original.svg' },
};

export interface PlatformToken {
  label: string;
  short: string;
  style: CSSProperties;
  logoSrc?: string;
}

export function getPlatformToken(name: string): PlatformToken {
  const definition = platformDefinitions[name] ?? {
    short: name.slice(0, 3).toUpperCase(),
    tone: 'slate' as const,
  };
  const [start, end] = toneStops[definition.tone];

  return {
    label: definition.label ?? name,
    short: definition.short,
    logoSrc: definition.logoSrc,
    style: {
      ['--token-start' as string]: start,
      ['--token-end' as string]: end,
    } as CSSProperties,
  };
}
