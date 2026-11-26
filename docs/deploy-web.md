# 작업 지시서: 웹 데모 Cloudflare Pages 배포

## 목적

`web/`의 최신 코드를 운영 사이트 https://cat-pet-haptic.pages.dev/ 에 배포한다. Mac 앱은 이 사이트를 그대로 띄우므로, 배포 전까지는 아래 변경이 앱에 반영되지 않는다.

이번 배포에 들어가는 변경:

- **소리**
  - 고양이를 문지를 때 나던 "드르르륵" 소리를 없앴다. 클릭 샘플이 초당 약 24번 반복되던 문제다.
  - 대신 문지르는 속도를 따라가는 부드러운 털 스치는 소리를 낸다.
  - "두우우웅" 울리는 가르랑 합성음을 제거했다.
- **설정 기억**: 고른 고양이, 소리 켜기/끄기, 테마를 기억한다.
- **절전**: 아무 변화가 없을 때는 캔버스를 다시 그리지 않는다.
- **접근성**: 캔버스 이름, 알림 낭독, 키보드 포커스 표시, 작은 글씨 명암비를 개선했다.
- **haptics 연동**: 새 Mac 앱이 `window.petTheCatNative.texture`를 알리면, 페이지는 포인터가 고양이의 어느 부분 위에 있는지만 앱에 보낸다(`{kind: "zone"}`). 털 질감 진동은 앱이 직접 만든다.
- **입력과 자산 처리** (PR #1에 있던 수정):
  - 단축키는 Korean 입력기와 AZERTY 배열에서도 의도대로 동작하고, 버튼을 누른 뒤에도 T/M이 동작한다.
  - 이미지를 불러오지 못하면 다시 시도한다.
  - 사운드 파일이 없으면 알림을 띄운다.

## 호환성

- **기존 Mac 앱 v0.1.0**: 앱이 `petTheCatNative`를 알리지 않으므로, 페이지는 예전처럼 쓰다듬는 걸음마다 `tick`/`bump`를 보낸다. haptics는 계속 동작한다.
- **브라우저**: Mac 앱 밖에서는 haptics 없이 소리와 애니메이션만 나온다. 이전과 같다.

## 배포 대상

| 항목 | 값 |
|---|---|
| 저장소 | `auto-audio-lm/pet-the-cat-mac` |
| 기준 | `main` 브랜치 최신 커밋. 커밋 메시지에 "remove the purr drone"이 포함된 커밋 이후여야 한다. |
| 작업 디렉터리 | `web/` |
| Node | 22 이상 |
| 빌드 | `npm ci && npm run build` (prebuild가 사운드 6개를 복사하고, 필요한 자산 28개가 모두 있는지 검사한다) |
| 출력 | `web/dist` |
| Pages 프로젝트 | 운영 도메인 `cat-pet-haptic.pages.dev`를 가진 프로젝트. 이름은 보통 `cat-pet-haptic`이다. |

## 절차

1. 저장소를 받아 `main`을 기준으로 체크아웃한다.
2. 테스트를 실행한다. e2e 테스트는 Chrome이 필요하며, 경로를 `CHROME_PATH`로 지정할 수 있다.
   ```sh
   cd web
   npm ci
   npm test           # 단위 테스트
   npm run test:e2e   # 빌드 후 로컬 서버와 헤드리스 Chrome으로 검사
   ```
   하나라도 실패하면 배포하지 말고 결과를 회신한다.
3. 빌드한다.
   ```sh
   npm run build
   ```
4. 운영 브랜치로 배포한다.
   ```sh
   npx wrangler pages deploy dist --project-name <프로젝트 이름> --branch <프로젝트의 production 브랜치>
   ```
   Git 연동 자동 배포를 쓰는 프로젝트라면 명령 대신 대시보드에서 `main`의 최신 커밋 배포를 확인한다.

## 배포 후 확인

아래 명령은 누구나 실행할 수 있다.

```sh
SITE=https://cat-pet-haptic.pages.dev
JS="$SITE$(curl -s "$SITE/" | grep -oE '/assets/index-[^"]+\.js' | head -1)"
curl -s "$JS" | grep -c petTheCatNative     # 1 이상: 새 haptics 연동이 들어감
curl -s "$JS" | grep -c createOscillator    # 0: 가르랑 합성음이 빠짐
curl -sI "$SITE/sounds/uhk-soft.mp3" | grep -i content-type   # audio/mpeg
```

Mac 앱(이 저장소의 `./build.sh`로 빌드)에서 확인할 것:

- `--smoke-test`가 `smoke: ok`로 끝나야 한다.
  ```sh
  "build/Pet the Cat.app/Contents/MacOS/PetTheCat" --smoke-test
  ```
- 앱을 열고 소리를 켠 채 고양이를 문지른다. 드르륵거리는 소리와 웅웅 울리는 소리가 없어야 한다.
- 트랙패드에서 잔결 같은 약한 진동이 느껴져야 한다. 강도는 Haptics 메뉴에서 바꿀 수 있다.

## 문제가 생기면

Cloudflare 대시보드에서 Pages 프로젝트의 Deployments로 가서, 직전 운영 배포의 Rollback을 실행한다. 페이지가 바뀌어도 Mac 앱을 다시 빌드할 필요는 없다.

## 회신해 줄 내용

- 배포한 커밋 SHA와 배포 URL
- 테스트 결과(`npm test`, `npm run test:e2e`)
- 위 확인 명령 세 줄의 출력
