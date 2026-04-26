# Schedu

A teacher-facing curriculum workspace that bundles Supabase-powered auth, institution/section management, lesson planning, and automated calendar scheduling into a single Expo Router experience.

## Highlights

- **Supabase-first profile & institutions**: `(auth)` routes plus `profile/index.tsx`, `profile/settings.tsx`, and `profile/institution.tsx` keep teacher profiles, associated schools, sections, and preferences (default institution, filters, avatars, appearance) in sync with Supabase Postgres records.
- **Lesson planning stack**: `(tabs)/plans`, `(tabs)/library`, and `(tabs)/library/subject_detail.tsx` expose lesson plans, subjects, subject structure editing (units → chapters → lessons), and plan detail views that stay in-flight with Supabase tables such as `lesson_plans`, `subjects`, `chapters`, `lessons`, and `plan_entries`.
- **Calendar + scheduler**: `(tabs)/calendar/index.tsx` uses the current planning pipeline in `algorithm/buildSlots.ts`, `algorithm/buildBlocks.ts`, `algorithm/buildPacingPlan.ts`, `algorithm/placeBlocks.ts`, and `algorithm/validatePlan.ts`, surfaces monthly/daily timelines, and lets teachers tweak entries while respecting category color/legend rules defined in the calendar code base.
- **Create flow**: `(tabs)/create/*` guides teachers through building new subjects, lesson plans, notes, and activities, and routes back into the tab navigation once a creation path completes.
- **Curriculum extraction**: `components/pdf-extractor.tsx` accepts PDFs or images (it warns that image OCR needs a Dev Client because `react-native-mlkit-ocr` does not run in Expo Go), uploads files to Supabase Storage, and calls the `extract-text` Edge function before populating an editable text area.
- **Scheduler benchmarks**: `scripts/*.ts|.sh` benchmark and validate the current planning pipeline, exporting markdown/CSV summaries for slot generation, block placement, validation coverage, and utilization.

## Architecture

- **Expo Router** wires the `(auth)` and `(tabs)` layouts from `app/_layout.tsx`, with `ThemeProvider` wrapping the entire app. `lib/supabase.ts` bootstraps the Supabase client via `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_KEY`, and `context/theme.tsx` persists the user theme preference while reusing the color palette from `constants/colors.ts` and typography tokens from `constants/fonts.ts`.
- **Tab navigation**: `(tabs)/_layout.tsx` sets up Home, Calendar, Create, Library, and Plans tabs plus the modal create picker; each tab folder encapsulates its own components (e.g., `TabPageHeader`, pull-to-refresh hooks, Supabase interactions). `components/header.tsx` supplies the branded header, while `hooks/usePullToRefresh.ts` keeps `RefreshControl` usage consistent across profile/institution/library/plans screens.
- **State helpers**: `context/theme.tsx`, `hooks/usePullToRefresh.ts`, and the `ThemeProvider` ensure the same theming and refreshing logic is shared across calendar, profile, and library screens.

## Getting started

1. Install dependencies: `npm install` (Expo-managed workflow on React Native 0.81 / React 19).
2. Supply Supabase credentials in `.env` (or your own env loading strategy):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_KEY` (anon/public key)
3. Optional: inspect or run the SQL scripts in `database-setup/00_users.sql` through `database-setup/07_meeting_type_patch.sql` to provision every table, enum, policy, and helper function the UI expects.

## Running the app

- `npm start` (runs `expo start`).
- `npm run android`, `npm run ios`, or `npm run web` to target a specific platform.
- `npm run lint` to validate TypeScript + ESLint rules.
- `npm run reset-project` re-runs `scripts/reset-project.js` to clear Turbo/Metro caches if the build gets stuck.

## Supabase & backend notes

- Supabase Auth is used throughout `(auth)`, `profile`, `plans`, `library`, and `calendar` screens; each screen calls `supabase.auth.getUser()` or relies on `supabase.auth.signIn`/`signOut`.
- Storage buckets under `uploads` hold school avatars, subject images, PDFs, and extracted text artifacts; signed URLs are requested immediately after upload so avatars/curriculum artworks can render.
- `components/pdf-extractor.tsx` uploads curriculum files to `users/<id>/pdfs/...`, then invokes the `extract-text` Edge Function via `supabase.functions.invoke` (it sends the `storagePath` and uses the current session token).

## Notes & troubleshooting

- The calendar view in `(tabs)/calendar/index.tsx` runs on the current planner modules in `algorithm/*` and animates UI updates with `LayoutAnimation` + pinch-to-zoom gestures.
- Image OCR requires a Dev Build because `react-native-mlkit-ocr` needs native binaries; PDFs are processed via the `extract-text` Edge Function so Expo Go is not strictly required for that flow.
- `scripts/scheduler-benchmark.ts` plus the `.sh` wrappers can be used to benchmark the scheduler, producing markdown/CSV/LaTeX summaries in `generated/scheduler-benchmarks/`.
- Adjust `constants/colors.ts`, `constants/fonts.ts`, or `context/theme.tsx` if you need to rebrand colors or typography.

See the individual folders for screen-specific details (e.g., `app/profile`, `app/(tabs)/library`, `app/(tabs)/calendar`, and `components`).
