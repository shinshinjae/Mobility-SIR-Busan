# GitHub 업로드와 웹사이트 확인 방법

이 문서는 `Mobility-SIR-Busan` 폴더를 GitHub에 올리고, GitHub Pages로 웹사이트를 공개·확인하는 절차입니다.
GitHub 계정: **shinshinjae** · 저장소 이름: **Mobility-SIR-Busan**
완료 후 주소: **https://shinshinjae.github.io/Mobility-SIR-Busan/**

> 공개 전에 확인할 것: 선행연구 그림(`docs/assets/img`)과 수치를 공개해도 되는지 공동저자의 동의를 받습니다. 저장소에는 개인정보(연락처·생년월일 등)를 넣지 않습니다.

---

## 방법 A. 터미널 (git + gh) — 가장 빠름

이 PC에는 git과 GitHub CLI(gh)가 설치되어 있고 `shinshinjae` 계정으로 로그인되어 있습니다.

### 1) 커밋 작성자 정보 설정 (처음 한 번)
```bash
git config --global user.name "Jaewan Shin"
git config --global user.email "345836801+shinshinjae@users.noreply.github.com"
```
공개 저장소의 커밋 기록에 개인 메일이 드러나지 않도록 GitHub가 주는 noreply 주소(Settings → Emails)를 씁니다.

### 2) 폴더로 이동해 첫 커밋 만들기
```bash
cd ~/Desktop/"부산 데이터위크"/Mobility-SIR-Busan
git init -b main
git add .
git commit -m "Mobility-SIR 부산: 도시철도 이동성 기반 인플루엔자 전파 분석 웹 서비스"
```
(이미 `git init`과 커밋이 되어 있다면 이 단계는 건너뜁니다. `git status`로 확인할 수 있습니다.)

### 3) GitHub에 공개 저장소를 만들고 올리기
```bash
gh repo create shinshinjae/Mobility-SIR-Busan --public --source=. --remote=origin --push \
  --description "BUSAN DATA WEEK 2026 · 도시철도 승차 데이터 기반 인플루엔자 전파 분석(Mobility-SIR)"
```

### 4) GitHub Pages 켜기 (main 브랜치의 /docs 폴더)
```bash
gh api -X POST repos/shinshinjae/Mobility-SIR-Busan/pages \
  -f "source[branch]=main" -f "source[path]=/docs"
gh api repos/shinshinjae/Mobility-SIR-Busan -X PATCH -f homepage="https://shinshinjae.github.io/Mobility-SIR-Busan/"
```

### 5) 배포 상태 확인
```bash
gh api repos/shinshinjae/Mobility-SIR-Busan/pages --jq '.status, .html_url'
```
`built`가 나오면 완료입니다(보통 1~3분).

---

## 방법 B. GitHub 웹사이트에서 (터미널 없이)

1. https://github.com/new 접속 → Repository name `Mobility-SIR-Busan`, **Public** 선택 → `Create repository`.
2. 새 저장소 화면에서 **uploading an existing file** 클릭.
3. Finder에서 `Mobility-SIR-Busan` 폴더 **안의 내용 전체**(docs, analysis, tests, image, scripts, README.md 등)를 끌어다 놓습니다.
   - 숨김 파일(`.github`, `.gitignore`, `docs/.nojekyll`)은 Finder에서 `Cmd + Shift + .`을 눌러 보이게 한 뒤 함께 올립니다.
   - 웹 업로드는 한 번에 100개 파일까지 가능합니다. 이 저장소는 그보다 적습니다.
4. 아래 `Commit changes` 클릭.
5. 저장소 상단 **Settings → Pages** 이동.
6. **Build and deployment**에서 Source = `Deploy from a branch`, Branch = `main`, Folder = `/docs` → **Save**.
7. 1~3분 뒤 같은 화면 위쪽에 `Your site is live at https://shinshinjae.github.io/Mobility-SIR-Busan/`가 표시됩니다.

---

## 웹사이트 확인 방법

1. 저장소의 **Actions** 탭에서 `pages build and deployment`가 초록색 체크(✓)인지 확인합니다. `tests` 워크플로도 함께 돌며 테스트 18개 결과를 보여줍니다.
2. 아래 주소를 열어 각 화면을 확인합니다.

| 화면 | 주소 |
|---|---|
| 개요 | https://shinshinjae.github.io/Mobility-SIR-Busan/ |
| 부산 대시보드 | https://shinshinjae.github.io/Mobility-SIR-Busan/#dashboard |
| 시즌 전체 보기 | https://shinshinjae.github.io/Mobility-SIR-Busan/#dashboard?asof=2026-08-31 |
| 요인 분해 | https://shinshinjae.github.io/Mobility-SIR-Busan/#decompose |
| 이동량 시나리오 | https://shinshinjae.github.io/Mobility-SIR-Busan/#scenario |
| 연구 근거 | https://shinshinjae.github.io/Mobility-SIR-Busan/#research |
| 수리모형 | https://shinshinjae.github.io/Mobility-SIR-Busan/#method |
| 주간 브리핑 | https://shinshinjae.github.io/Mobility-SIR-Busan/#briefing |
| 데이터·업로드 | https://shinshinjae.github.io/Mobility-SIR-Busan/#data |

3. 휴대폰으로도 열어 화면이 잘리지 않는지 확인합니다.
4. 저장소 첫 화면(README)에서 서비스 구조도(mermaid)와 시연 화면 이미지가 보이는지 확인합니다.

---

## 수정 후 다시 올리기

```bash
cd ~/Desktop/"부산 데이터위크"/Mobility-SIR-Busan
git add .
git commit -m "수정 내용 요약"
git push
```
1~3분 뒤 사이트에 반영됩니다. 바뀐 화면이 안 보이면 `Cmd + Shift + R`(강력 새로고침)을 누릅니다.

화면 캡처를 새로 만들 때는:
```bash
python3 -m http.server 8765 --directory docs &
node scripts/screenshots.mjs
```

---

## 자주 생기는 문제

| 증상 | 해결 |
|---|---|
| 404 페이지 | Settings → Pages에서 Folder가 `/docs`인지, `docs/index.html`이 올라갔는지 확인 |
| 화면은 뜨는데 그래프가 비어 있음 | `docs/data/*.json`이 올라갔는지 확인. 로컬에서 `file://`로 열었다면 로컬 서버로 열기 |
| 수식이 `$$…$$`로 보임 | 인터넷 연결 확인(KaTeX를 CDN에서 불러옴) |
| Pages 메뉴가 없음 | 무료 계정은 **Public** 저장소에서만 Pages 사용 가능 |
| push 권한 오류 | `gh auth status`로 로그인 계정 확인, 필요하면 `gh auth login` |

---

## 공모전 제출물에 넣을 정보

- 웹 서비스: https://shinshinjae.github.io/Mobility-SIR-Busan/
- 소스 코드: https://github.com/shinshinjae/Mobility-SIR-Busan
- 선행연구 코드: https://github.com/jaewansh/KMOU-A-mobility-informed-SIR-model
