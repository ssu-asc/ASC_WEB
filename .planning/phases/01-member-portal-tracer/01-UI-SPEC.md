# Phase 1 UI Spec — Member Portal Tracer

## Design Rule

The existing ASC website is the design source of truth. Do not introduce a new dashboard theme or component library.

## Existing Tokens to Preserve

- background: `#121212`
- primary accent: `#4B77d8`
- white/gray text hierarchy already defined in the site
- Pretendard for body/UI
- TheJamsil for ASC-style titles where already used
- `var(--padding)` responsive horizontal spacing
- `DefaultBtn` interaction language
- existing fixed transparent-to-dark Header behavior
- existing Footer
- existing CSS-module architecture

## Header Change

Desktop navigation becomes:

`Home | Hall of Fame | Blog | Q&A | Member`

Keep the existing `Apply Us` button exactly where it is.

Mobile menu adds the same `Member` entry.

No other public navigation or homepage layout changes are part of this phase.

## `/member/login`

- dark site background, existing Header/Footer
- one centered content column, approximately 420–520px maximum width
- heading: `ASC Member`
- short helper copy only
- member ID field
- password field
- existing button style for `로그인`
- inline error text, no toast framework
- no signup, social login, passwordless login, or decorative marketing blocks

The page should feel like a quiet extension of the current website rather than a separate admin product.

## `/member`

### Top section

- normal page flow below fixed header, with enough top padding to avoid overlap
- title: `2026-2 Project`
- description: `이번 학기 프로젝트 제출 현황을 확인하고 제출할 수 있습니다.`
- member name / ID presented as secondary text
- logout action visually secondary

### Submission cards

Two cards only:

1. `개인 프로젝트`
2. `팀 프로젝트`

Each card contains:

- type/title
- deadline
- status label
- short next-action sentence
- one primary action (`제출하기`, `수정하기`, or `확인하기`)

Use the existing visual vocabulary:

- translucent dark surface / subtle white border
- rounded corners consistent with existing cards
- white title
- muted gray metadata
- accent blue only for important state/action emphasis

Do not use colorful SaaS-style dashboard widgets.

## Status Presentation

- `미제출`: muted/neutral
- `제출완료`: accent blue
- `수정요청`: visually noticeable but do not introduce a large new color system; icon/text/border treatment may carry emphasis
- `승인`: positive state expressed primarily through text/icon and subtle treatment

Accessibility must not depend on color alone.

## Motion

- reuse existing fade motion sparingly on initial section/card appearance
- no animated counters, charts, drawer systems, or complex dashboard transitions
- form interaction should prioritize clarity over animation

## Responsive Contract

At <=720px:

- cards stack vertically
- all controls become full-width where appropriate
- preserve `var(--padding)` behavior
- no horizontal table or clipped hover-only UI
- status and deadline remain visible without hover

## Explicit UI Non-Goals

- redesigning Home
- sidebar navigation
- admin SaaS dashboard styling
- new icon library unless an existing `react-icons` icon is reused
- new typography system
- light mode
