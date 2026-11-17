# Mazda Data Dashboard

**A private dashboard for the data your Mazda sends to Mazda.** Mazda lets you download a copy of it, but
what you get is a pile of CSV files. This project turns them into a database, a dashboard and alerts that
run entirely on your own computer, and puts the same dashboard on your iPhone, **offline, with the data on
the phone**.

- **See**: odometer, distance and fuel economy (and, if you enter a fuel price, an *estimated* cost), trips,
  tire pressure (and when the car really measured it), the car's own oil-change countdown, warnings, fault
  codes with their freeze frames, the diagnostic-tool report, a month-by-month comparison, and a comparison of
  two cars or of two periods of one car.
- **Understand the car day to day**: the fill-ups the fuel level shows, how the car is driven (short and long
  stretches), everything that happened on one day, your own service log marked on the charts, and whether your
  data has gaps.
- **Look ahead**: the next oil change as dates at your recent pace, the year's distance against a limit you
  set, a tire that is slowly losing pressure, and a calendar file of those dates.
- **The car in 3D**: a schematic of your car you can turn and zoom, with tire pressures, doors, fuel, the oil
  countdown and the odometer shown next to the part they belong to, what needs a look marked, and a slider to
  step back through the period. On the Mac and on the phone.
- **Get told**: alerts for a new or recurring fault, a warning spike, an alarm event, a low supply voltage in
  a fault's freeze frame, unusually high fuel use, low tire pressure or a slow leak, an oil change coming up,
  the warning flags the car raises itself, and a stale export.
- **Take it to the workshop**: a one-page report to print or save as a PDF, with the faults, what surrounded
  them and the car's state.
- **Add data without a terminal**: drop Mazda's download on the *Import* page and see what changed.
- **Your units and your language**: tire pressure in kPa, bar or psi, fuel consumption in l/100 km, km/l or
  mpg, distance in km or miles; English or Portuguese (Portugal). Chosen once per device.
- **Several cars**: one folder of exports, one database and one set of code descriptions per Mazda model
  (the CX-5, and a CX-60 set up the same way), a model selector, an *All cars* overview and a *Compare* page,
  on the Mac and on the phone.
- **Stay private**: nothing is uploaded anywhere. The data stays in a file on your machine (and, if you
  want it, on your phone); the phone app makes no network request at all once installed.
- **Try it first**: no Mazda data needed. `make demo` runs the dashboard on synthetic data, and the phone
  app has a live demo: <https://ajmcastro.github.io/mazda-data-dashboard/> (open it on a phone, tap
  *Load demo data*).

![Overview](docs/screenshots/overview.png)

<table>
  <tr>
    <td><img src="docs/screenshots/warning-lamps.png" alt="Warning lamps: the car's bit flags that ever change, with a timeline and hints"></td>
    <td><img src="docs/screenshots/status.png" alt="Status: fuel level with the fill-ups marked, tire pressure at the time it was measured, and the list of fill-ups"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/trends.png" alt="Month-by-month trends"></td>
    <td><img src="docs/screenshots/alerts.png" alt="Alerts"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/faults.png" alt="Fault explorer with freeze frames"></td>
    <td><img src="docs/screenshots/diagnostics.png" alt="Diagnostic tool report"></td>
  </tr>
</table>

The newer pages: what is ahead, how the car is driven, one day at a glance, the report for the workshop, and how
far the data can be trusted.

<table>
  <tr>
    <td><img src="docs/screenshots/looking-ahead.png" alt="Looking ahead on the Overview: the oil change as two dates at the recent pace, the year's distance against a limit, a tire losing pressure, and the calendar file"></td>
    <td><img src="docs/screenshots/driving.png" alt="How the car is driven, on Trends: stretches of driving by length with distance, fuel and consumption, and by month"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/day.png" alt="The Day page: one day's warnings, an alert, a drive, a status report and a fill-up, in order, in the car's own time"></td>
    <td><img src="docs/screenshots/report.png" alt="The report for the workshop: sections to include, the car and its faults, ready to print or save as a PDF"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/data-health.png" alt="Data health: days with a status report, the longest silence, invalid readings, and what each export file covers"></td>
    <td><img src="docs/screenshots/who-rides-cx60.png" alt="Who rides, on the second demo car: the share of status reports with each seat belt buckled, and the seats seen from above"></td>
  </tr>
</table>

The Status page opens with **the car in 3D**, with each figure next to the part it belongs to:

<table>
  <tr>
    <td><img src="docs/screenshots/car-3d.png" alt="The CX-5 in 3D on the Status page: tire pressures, fuel, oil change and odometer at the parts, the rear left wheel marked"></td>
    <td><img src="docs/screenshots/car-3d-cx60.png" alt="The CX-60 in 3D: its own silhouette, the front left wheel marked"></td>
  </tr>
</table>

- **Turn and zoom.** Drag to turn the car, or use the Front / Side / Rear / Top buttons. Zoom with Ctrl + scroll
  (a trackpad pinch does the same) or the + and − buttons; plain scrolling still scrolls the page. With the
  keyboard: arrow keys turn, + and − zoom, Home resets the view.
- **What the colours mean.** A part to check is red (the car's own warning flag for it, a wheel clearly lower
  than the others, an oil change due soon), an open door, trunk or hood is amber and drawn open, and something
  the car did not report is a dashed outline. Nothing else is judged: the dashboard invents no limits.
- **Details.** Click a part or its label for the notes behind the figure (when a tire was measured, the lock
  code of a door). Closed doors get a label only when you click them.
- **List.** The *3D | List* switch shows the same parts as a plain list, which is also what you get in a
  browser that cannot draw 3D.
- **On the phone** there is no room for labels beside the car, so the parts are numbered pins and the figures
  are listed under it; a sideways swipe turns the car, an up-and-down swipe scrolls the page.
- **The shape is a schematic, not the real body.** It is built in code from each model's dimensions. The CX-5
  sold from 2026 and the CX-60 have their own silhouette, traced by hand from the owner's photos of the two
  cars (a likeness in flat facets, not a measured model); any other model is drawn as a generic SUV.

With more than one car model loaded, the sidebar has a model selector (here the second demo car, a CX-60), an
*All cars* page and a *Compare* page (two cars, or two periods of one car):

![Overview of the second demo model, a CX-60](docs/screenshots/overview-cx60.png)

<table>
  <tr>
    <td><img src="docs/screenshots/all-cars.png" alt="All cars: a card per car model with its headline figures, new alerts and faults"></td>
    <td><img src="docs/screenshots/compare.png" alt="Compare: two car models side by side, each figure marked comparable or not"></td>
  </tr>
</table>

**On the iPhone** (offline, installable; dark and light follow the phone, or choose):

<p>
  <img src="docs/screenshots/phone-overview.png" alt="Overview on an iPhone, dark" width="230">
  <img src="docs/screenshots/phone-overview-light.png" alt="Overview on an iPhone, light" width="230">
  <img src="docs/screenshots/phone-alerts.png" alt="Alerts on an iPhone" width="230">
  <img src="docs/screenshots/phone-lamps.png" alt="Warning lamps on an iPhone" width="230">
  <img src="docs/screenshots/phone-car-3d.png" alt="The car in 3D on an iPhone: numbered pins on the car, the figures listed under it" width="230">
</p>

*(Screenshots show the synthetic demo data in `sample_data/<model>/`, not a real car. `make screenshots` retakes them.)*

> **Unofficial.** This project is not affiliated with or endorsed by Mazda. The meaning of most
> warning and fault codes is not public, so the app ships with descriptions only where they are
> standard (SAE) and lets you add the rest. Several signal interpretations are inferred from the
> data (see [docs/data-dictionary.md](docs/data-dictionary.md)). It is a curiosity tool, not a
> substitute for a mechanic.

## Contents

- [Try it in two minutes (no data needed)](#try-it-in-two-minutes-no-data-needed)
- [What is in the dashboard](#what-is-in-the-dashboard): the pages, the words used, units, language, periods
- [Use your own data](#use-your-own-data): getting it from Mazda, loading it, car models, and the optional
  settings (time zone, fuel cost, fill-ups, looking ahead, service log, fault map, clues for unknown codes, sharing code descriptions)
- [Use it on your iPhone](#use-it-on-your-iphone-offline-with-your-data-on-the-phone)
- [Alerts](#alerts) · [Commands](#commands) · [How it works](#how-it-works) · [Limitations](#limitations)
- [Privacy](#privacy) · [Troubleshooting](#troubleshooting) · [Development](#development)

## Try it in two minutes (no data needed)

### 1. Install the tools

You need three tools (plus `git` to download the code). Developed on macOS; the tests and builds also
run on Linux (Ubuntu) in CI; on Windows use WSL (below, not tested by the author).

| Tool | What for | macOS | Linux (Debian / Ubuntu) |
|---|---|---|---|
| [**uv**](https://docs.astral.sh/uv/getting-started/installation/) | Python and the backend's packages | `brew install uv` | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| [**Node.js**](https://nodejs.org/) 20 or newer, with npm (tested with 20) | the dashboard (frontend) | `brew install node` | see the note below |
| **make** | runs the project's commands | `xcode-select --install` | `sudo apt install make` |

- **uv** also downloads the right Python (3.12) by itself, so you do not need to install Python.
  If you do not use Homebrew on macOS, use the Linux command above.
- **Node.js** on Linux: the distribution's package is often too old. Install a current one from
  [nodejs.org](https://nodejs.org/en/download) or with [nvm](https://github.com/nvm-sh/nvm)
  (`nvm install 20`). `npm` comes with Node.js.
- **make** on macOS comes with the Xcode command line tools (the one that ships with macOS is
  old but works). On Fedora use `sudo dnf install make`.
- **Windows**: install [WSL](https://learn.microsoft.com/windows/wsl/install) (`wsl --install` in
  an administrator PowerShell, then open the Ubuntu terminal) and follow the Linux column
  inside it. Keep the project in the Linux file system (e.g. in your WSL home folder), not under
  `/mnt/c`, and open the dashboard from your normal browser at the address below.

Check that everything is in place (open a new terminal first if you just installed something):

```bash
uv --version
node --version   # v20 or higher
make --version
git --version
```

### 2. Get the code and start the demo

```bash
git clone https://github.com/ajmcastro/mazda-data-dashboard.git
cd mazda-data-dashboard
make setup   # Python (via uv) and npm dependencies, takes a minute or two the first time
make demo    # loads the synthetic sample data, then serves it
```

Open <http://localhost:5173> in your browser. Stop the demo with Ctrl+C in the terminal.

The demo has its own databases (`db/demo-cx5.duckdb` and `db/demo-cx60.duckdb`, one per demo car) and never
touches your real ones (`db/<id>.duckdb`). The sidebar has a model selector with the two demo cars. You can tell
you are looking at the demo by the sidebar footer, which shows a made-up VIN (`…000001` for the CX-5,
`…000002` for the CX-60), and by data that ends on 30 June 2026 (CX-5) or 31 July 2026 (CX-60).

## What is in the dashboard

The pages, in the order of the Mac's menu. On the phone, Overview, Trends, Alerts and Faults are tabs and the rest
are under *More*.

| Page | What it shows |
|---|---|
| **Overview** | Odometer, distance, fuel economy (with the estimated cost per 100 km when a fuel price is set), fuel level and the last fill-up, the car's own **next oil change** countdown, tire pressures (with when the car measured them), and what needs attention: new alerts, faults still listed, any warning flag the car itself raises. **Looking ahead**: the oil change as two dates at your recent pace, the year's distance against an optional limit, any tire losing pressure, and a calendar file of those dates (see [Looking ahead](#looking-ahead-optional-limit)). |
| **Trends** | Every month compared with the one before, including the estimated fuel cost when a fuel price is set. **How the car is driven**: the stretches of driving by length (under 5 km, 5–20, 20–100, over 100) with the distance, fuel and consumption of each, by month too, and a sentence when a month's consumption and its share of short stretches moved together. |
| **Compare** | **Two cars** side by side (when two models have data): the months both cars have complete, per day, with every figure marked *comparable*, *compare with care* or *not comparable*; only "higher" and "lower", never "better" or "worse". Or **two periods of the car on screen** (one car is enough): last 30 days against the 30 before, this month against the month before or a year ago, before and after a date, or any two periods you pick; here, since it is the same car, the colours say whether a change is good or bad. It uses each car's own history, not the period bar. |
| **Alerts** | What the alert rules raised; acknowledge them one by one or all at once. The car on the Status page marks the parts that have open alerts, and a click on a marker shows only those. |
| **Warnings** | Warning events per day, how often each code appears, and the events behind each code. Click a day on the chart to open that day. |
| **Faults** | Trouble codes (active or cleared), their history, freeze-frame data, what else happened around them, and **Show on the car** for what a fault's freeze frames have in common. A **fault map** shows the control units you placed on a plan of the car, lit by their faults (see [Fault map](#fault-map-optional)). |
| **Status** | **The car in 3D** (or the same as a list; numbered pins on the phone), with a **slider** that steps back through the status reports of the period or plays them. Then, each in its own panel: fuel level and range; tire pressure per wheel at the time the car **measured** it, and for a wheel losing pressure against the other three, how fast and when it reaches your limit at that rate; the **fill-ups** (see [Fill-ups](#fill-ups-optional)); the **service log** (see [Service log](#service-log-optional)); the car's own warning flags; the **warning lamps** (the car's 128 bit flags: the few that ever change, each with a timeline and hints about what happens around it); when the car is used (by hour and weekday); who rides (from the seat belts, when the car sends them); the oil-change countdown; recent trips and the alarm history. |
| **Diagnostics** | The diagnostic report(s) in your downloads: emission monitors, stored fault lists, counters, and how they changed from one report to the next. |
| **All cars** | One card per car model with data: its side view, the odometer, the last 30 days, the **fuel used and its cost** over those days (estimates; the cost only when a fuel price is set), fuel level, the car's own next-oil-change countdown, new alerts, faults still listed, the car's own warnings that are on, and a note when its newest reading is more than a week old. |
| **Day** | One day at a glance, in the car's own time: the stretches driven, each status report with what changed, doors, the warning codes of the day, fault read-outs, alarm reports, a fill-up, a service-log entry, a diagnostic report and the alerts about that day, in order, each linking to its page. Arrows step to the previous and next day that has anything. |
| **Report** | One page to print or save as a PDF for the workshop, for the period you chose: the car, its faults with what their freeze frames show, the car's own warnings, the warning-lamp flags that changed, tires, the newest diagnostic report against the one before, your service log and the open alerts. Untick what you do not want; the VIN is left out unless you tick it. |
| **Data health** | How far to trust the rest: what each kind of export file covers (first and last record, how many, on how many days), how many days have a status report, the silences between status reports of two days or more, and the signals the car itself flagged as Invalid (those readings are never used). It describes the exports, not the car. |
| **Import** (the Mac only) | Drop a new download from Mazda on the page: it is checked, stored in the model's data folder, loaded, and summarised (new rows, the newest day, distance since the last load, faults that appeared or left, new warning codes, new alerts). See [Adding newer data later](#adding-newer-data-later). |

**Words used here.** A *warning code* is one of the `$XXX` codes in the warnings export (Mazda does not
publish their meaning). A *fault* (DTC) is a trouble code stored by one of the car's control units (ECUs),
with *freeze-frame* data captured when it appeared. A *snapshot*, *reading* or *status report* is one
report of its state the car sent. A *stretch* is the driving between two status reports in a row (the car does
not report single trips, so a stretch can be part of a trip or several short ones). A *fill-up* is a rise of the
fuel level between two status reports. The *car's own warnings* are nine on/off flags it raises itself (tire pressure per wheel, tire
pressure system, oil level, seat belt, door). The *warning lamps* are 128 further bit flags that look like
dashboard lamps; almost all never change, and what they mean is unknown, so the dashboard shows the few
that do change and what happens around them. A *data pack* (`.cx5pack`) is your database exported for the
phone app.

**Units.** The three small lists at the bottom of the side menu (on the phone: *More → Data on this phone →
Units and language*) choose how figures are shown on this device: tire pressure in kPa, bar or psi; fuel consumption in
l/100 km, km/l, mpg (UK) or mpg (US); distance in km or miles (speeds and costs per distance follow). The data
itself does not change, and neither do the alert rules, which stay in kPa and km. With km/l or mpg a higher
figure means less fuel, so the green and red on Trends and Compare follow that. Two things keep the data's
units: the text of an alert (it is written when the data is loaded) and the raw values of a diagnostic report.

**Language.** Both apps are in **English and Portuguese (Portugal)**. The language menu (under the units on the
Mac; *More → Data on this phone* on the phone) offers *Auto*, *English* and *Português*: Auto follows your browser
(Portuguese when it asks for Portuguese before English, English otherwise). The choice is per device, and numbers
and dates follow it. What you wrote yourself stays as you wrote it (code descriptions, service notes), and so do
the car's own names (control units, signals) and the figures inside an alert.

![The Overview in Portuguese](docs/screenshots/overview-pt.png)

**Looking at a period.** The bar at the top of the Overview, Trends, Warnings, Faults, Status, Report and Data
health pages limits everything to a *from – to* range of days (UTC, both included). Use the quick
buttons (Last week, Last 2 weeks, Last 30 / 60 / 90 days, All time) or type your own dates. Quick
ranges count back from your **newest data**, not from today, so they still make sense when your
last export is a few weeks old, and your last quick choice is remembered in the browser. The
range is kept in the address, so you can bookmark it (a link with dates always wins over the
remembered choice), and it follows you from page to page. (*All cars* and *Compare* do not use it: they look at each car's own newest data or whole history; *Day* shows the day you pick.) Things that describe a *state* ignore
the range: the faults still active in the latest read-out, the alerts list, the car's own
warning flags, the warning-lamp flags, the oil-change countdown and the diagnostic-tool report.

**Trends.** Charts or a table show how each figure changed month by month: distance, fuel
consumption, warnings, faults, tire pressure and more. The change against the previous month is
green when it is good for that figure (less fuel use), red when it is bad, and grey when neither
direction is better (distance). Months the period cuts through are marked *partial*; tick
**per day** to compare them fairly with full months. A month with no data is a gap, never a zero. With a fuel price set (see [Fuel cost](#fuel-cost-optional)) two *estimated cost* figures appear next to the consumption.

**Diagnostics.** Pick any report from the **Report** list (the choice is kept in the address,
e.g. `?report=…`), see how the car's counters and fuel economy changed from one report to the next
in the report history, and use **Compare with** to see exactly which values changed between two
reports. An identical copy of a report you already loaded is recognised and skipped.

## Use your own data

### Where the data comes from: Mazda Vehicle Data

Mazda lets any driver of a Mazda download a copy of the data their connected car sends to Mazda,
through the **Mazda Vehicle Data** platform: <https://vehicledata.mazda.eu/>. The site describes
it as a way to get a copy of your vehicle's data and to choose who else may see it. The data travels
from the car over its embedded SIM card, so it applies to connected Mazdas, and what is
available depends on your vehicle's specification.

1. Open <https://vehicledata.mazda.eu/> and choose **Login** (top right).
2. No account yet? Open the **Sign up** tab (the login page's separate link for *third-party
   service providers* is not the one you want). Enter your email address to create an account;
   Mazda sends a **verification code** to it, which you enter to verify your identity. Follow
   the remaining sign-up screens; later you log in with your email address and a password.
3. **Register your vehicle.** After logging in the portal asks for your car's **VIN** and a
   **security code**. The code is not generated by the portal: you have to ask for it, either at
   a **Mazda dealer** or **directly from Mazda** (see the contact details below). You cannot
   register the vehicle without it, so ask for it first.
4. **Request the data.** Mazda prepares the report and sends you an **email when it is ready
   for download** (about an hour in one reported case). The portal also offers data
   dictionaries tailored to your vehicle, which explain the fields of your export.
5. **Download the zip file.** It contains the CSV files and the diagnostic report (a `.txt`
   file with `diag-tool` in its name). Unzip it and copy those files **directly into `data/cx5/`**
   (not into a sub-folder of it: only the top level of the model's folder is read), then continue below.

The portal's own screens are Mazda's and may change, so they are not reproduced here.

Things to know:

- The portal describes a report as the *most recent information stored* for your vehicle. To
  follow your car over time, request a new report every month or so and keep every download
  (the diagnostic report in it is loaded too); see
  [Adding newer data later](#adding-newer-data-later).
- The files contain your VIN and may contain GPS positions. Keep them private (see
  [Privacy](#privacy)); the portal's own privacy policy and terms are linked at the bottom of
  its pages.
- Questions about the platform, your request or the security code go to Mazda, not to this
  project: use the *Contact us* link on the portal (it points to Mazda Europe's contact page),
  or your Mazda dealer. The portal names `vehicledata@mazdaeur.com` as the address of Mazda's
  Data Act team.
- This project is not affiliated with Mazda, and these steps come from the portal's public
  pages and a user's own experience. If Mazda changes the process, the portal is the authority.

### Load it

1. Put your export files in `data/cx5/` (git-ignored; `cx5` is the model: for another car use its own folder, see [Car models](#car-models)). Files are recognised by name:

   | Contains | File name pattern |
   |---|---|
   | warnings | `*_war-*.csv` |
   | fault read-outs | `*_dtc-h-*.csv` and `*_dtc-d-*.csv` |
   | fault freeze frames | `*_dtc-ssr-*.csv` |
   | remote vehicle status | `*_rts-*.csv` |
   | door and light status | `*_vis-*.csv` |
   | alarm status | `*_alt-*.csv` |
   | diagnostic tool report | `*diag-tool*.txt` |

2. `make ingest`: loads everything into `db/<id>.duckdb` (safe to re-run whenever you get a
   newer export) and evaluates the alert rules.
3. `make dev`: starts the API (`:8000`) and the dashboard (`:5173`). Open <http://localhost:5173>.

Once the dashboard runs you no longer need the terminal for new downloads: the **Import** page takes Mazda's zip
(see [Adding newer data later](#adding-newer-data-later)).

Run `make unmapped` to see warning and fault codes (and warning-lamp flags) that have no description
yet, then add what you learn to `config/models/<id>/codes/*.yaml` (for the CX-5, `config/models/cx5/codes/`) and run `make model`.
For clues about what an unknown code or flag goes with, see [Clues for unknown codes](#clues-for-unknown-codes).

### Car models

The dashboard is organised by car model, so one install can follow several cars (a CX-5 and a CX-60, say).
Each model has its own:

| What | Where |
|---|---|
| raw exports | `data/<id>/` (git-ignored) |
| database | `db/<id>.duckdb` (git-ignored) |
| configuration | `config/models/<id>/`: `model.yaml`, `settings.yaml`, `alerts.yaml`, `codes/*.yaml`, and the optional files you keep yourself: `fuel_log.yaml`, `service_log.yaml`, `layout.yaml` |
| phone data pack | `db/<id>.cx5pack` (git-ignored, holds the VIN) |
| synthetic demo data | `sample_data/<id>/` (committed) |

`config/models.yaml` lists the models in display order (`cx5` and `cx60` are set up). **Nothing is shared
between models**, least of all the descriptions of codes: Mazda does not publish them and they can differ
from one model to the next. A model without `alerts.yaml` or `settings.yaml` uses the built-in defaults (every
alert rule on, time zone UTC), never another model's files. `make models` shows where everything is.

`MODEL=<id>` limits a command to one model (`MODEL=cx60 make ingest`). Without it, `make ingest` visits every
model, `make model`, `alerts`, `timezone`, `unmapped`, `compat` and `mobile-pack` run for every model that
already has a database, and `make reset-db` asks you to name one. A model's folder holds **one car**:
`make ingest` warns when it finds two VINs in a model's data.

**In the dashboard** (and in the phone app) a *model selector* appears at the top once two models have data. The
choice is in the address (`?model=cx60`, so a link opens the same car), is remembered for next time, and
keeps your period when it makes sense (a quick range such as *Last 30 days* is counted again from the other
model's newest day). A model without data yet stays out of the list; the address `?model=cx60` says where to
put its files. Each entry also shows that car's new alerts ("Mazda CX-5 · 15 alerts"), and the *All cars* page puts every car's headline figures side by side.

#### How to add a model

Say you have an export for another car (here an MX-30, id `mx30`). Run these from the project folder:

1. **Describe the model.** Copy a model's configuration folder and edit its `model.yaml` (`id` must match the
   folder name: lower-case letters and digits; `name` is what the selector shows; `platform` is optional),
   then add the id to the list in `config/models.yaml`:

   ```bash
   cp -r config/models/cx60 config/models/mx30
   ```

   Optionally give the car's outer dimensions and steering side in `model.yaml`, for the 3D drawing on the
   Status page (millimetres, from the owner's manual; leave out what you do not know and a generic car's
   proportion is used; `steering` decides which side the driver's door is drawn on):

   ```yaml
   body:
     length_mm: 4395
     width_mm: 1795
     height_mm: 1555
     wheelbase_mm: 2655
     steering: left      # left | right
   ```

   Also accepted: `track_mm`, `wheel_diameter_mm` and `shape` (the outline that is drawn: `generic`, the
   default, `cx5` for the CX-5 sold from 2026, or `cx60`; a new model uses the generic one). Giving another
   model its own silhouette means adding a small file of numbers to the code: see
   [CONTRIBUTING](CONTRIBUTING.md). For the phone the dimensions travel in the data pack,
   so make a new pack (`make mobile-pack`) after changing them.

   The copied code descriptions start empty on purpose. Set `car_timezone` in the new `settings.yaml` to where
   the car lives (`make timezone MODEL=mx30` checks it against your data).
2. **Put the exports in `data/mx30/`**, exactly as Mazda sent them. The file names carry the platform code of
   the car (`24pf` in the author's CX-5 files); it does not matter what it is, files are recognised by the
   `_war-`, `_dtc-d-`, ... part (see [Load it](#load-it)).
3. **Load them:** `make ingest MODEL=mx30`. It reports what it read and warns about an empty folder or a
   second VIN.
4. **See what the data lacks:** `make compat MODEL=mx30`. It lists the signals the dashboard reads that this
   car does not send (with the views they feed: that part of the dashboard will be empty, nothing breaks),
   and the signals it sends that nothing reads yet. Then `make unmapped MODEL=mx30` lists the codes with no
   description, which you fill in under `config/models/mx30/codes/` as you learn them (`make model
   MODEL=mx30` applies the changes).
5. **Look at it:** `make dev`; the model appears in the selector. For the phone: `make mobile-pack` writes
   `db/mx30.cx5pack`; import it next to the others.

If `make compat` reports missing signals that matter to you (a plug-in hybrid has battery and charging
signals no view reads yet), the dashboard needs a new view for them: that is a code change, see
[CONTRIBUTING](CONTRIBUTING.md). The CX-60 in the repository is set up with *synthetic* data only (a car that
differs from the CX-5 on purpose); no real CX-60 export has been tried yet.

**If you used an earlier version** with the files directly in `data/` and `db/mazda.duckdb`: nothing breaks,
they are still read as the `cx5` model. `make migrate-models` moves them into `data/cx5/` and `db/cx5.duckdb`
(it shows what it will move and asks first, and never overwrites). Your own edits in `config/` need moving
by hand into `config/models/cx5/` (`codes/`, `settings.yaml`, `alerts.yaml`).

### Set your time zone (once)

The car reports *when it measured the tire pressures* in its own **local** time. To show that time
correctly (and to know how old a reading is), the dashboard needs your car's time zone: open
[config/models/cx5/settings.yaml](config/models/cx5/settings.yaml) and set `car_timezone` to your IANA zone name (for example
`Europe/Berlin` or `America/New_York`; the file in the repository has the author's zone, `Europe/Lisbon`).
Then check it against your data:

```bash
make timezone
```

It says whether the zone fits (no measurement in the future, most a few minutes before the snapshot) and,
if not, lists the clocks that do. Apply a change with `make model`.

### Fuel cost (optional)

The dashboard can turn the fuel the car reports into an **estimated cost**: *Fuel cost per 100 km* and *Fuel cost,
total* on Trends and Compare, and a line under the fuel economy on the Overview. It is an estimate, **not what you
paid**: the litres the car reports for each trip times the fuel price you enter. Without a price none of it is
shown (the dashboard never invents one). Add a price to your model's `settings.yaml`:

```yaml
fuel_currency: EUR              # an ISO code
fuel_prices:                    # the price of a litre from a date on; one entry per date, oldest first
  - {from: 2026-03-01, per_l: 1.72}
  - {from: 2026-05-15, per_l: 1.81}
```

**The `settings.yaml` files in the repository hold the author's own prices (EUR, from June 2026): replace them with the prices you pay, or remove the `fuel_currency` and `fuel_prices` lines to switch the cost figures off.** (The demo uses its own prices, kept with the sample data, and never your settings.)

A single price is enough if it never changed (`fuel_price_per_l: 1.75` instead of the list; the oldest price also
applies before its date). Each trip is priced with the price in force on its day, so a price change shows up in the
months it happened. Then run `make model` (the phone app needs a new pack: `make mobile-pack`). It is per car: a
second model has its own file and its own currency, and the compare page does not set amounts in two currencies
against each other.

### Fill-ups (optional)

The Status page lists the **fill-ups**: every time the fuel level rose between two status reports. The car sends
the level in % only, so two optional lines in your model's `settings.yaml` make it more useful:

```yaml
tank_litres: 56          # the size of YOUR fuel tank (owner's manual): shows litres instead of points of the gauge
refuel_min_points: 15    # a smaller rise is listed as "doubtful" (default 15)
```

What it shows is an estimate and says so: a fill-up happened some time *between* two reports, the litres are what
the gauge gained (fuel burned in between is not seen, so the real amount is a little higher), and the cost is those
litres times your [fuel price](#fuel-cost-optional). A rise seen across two days or more without a report is marked
doubtful too.

To see **what you really paid** next to the estimate, keep a file `fuel_log.yaml` next to `settings.yaml`
(`config/models/<id>/fuel_log.yaml`), one line per payment, in the currency of `fuel_currency`:

```yaml
- {date: 2026-06-06, paid: 78.40, litres: 41.1}   # litres is optional
- {date: 2026-06-27, paid: 89.95}
```

A payment is matched to the fill-up seen around its date; one that matches none is listed under the table. Then run
`make model` (and, for the phone, `make mobile-pack` and import the new pack). The two amounts are never mixed: the
total says how many fill-ups the paid amount covers.

### Looking ahead (optional limit)

The Overview's *Looking ahead* panel turns the recent driving into dates: the **oil change** (the car's own countdown
divided by the distance you drove a day over the last 30 and the last 90 days: two dates), and the **distance a
year**. Everything is counted from the newest day in your data, not from today, and the panel says so. A car that
sends no oil countdown gets no oil date.

For a lease or warranty year, add your limit to the model's `settings.yaml` and run `make model`:

```yaml
mileage: {limit_km_per_year: 15000, start_date: 2026-03-03}
```

The panel then shows the distance so far this year and the projection against the limit. **Calendar file** downloads
the dates (oil change, end of the year, a tire reaching your pressure limit) as an `.ics` file made in the page:
open it to add them to your calendar; nothing is sent anywhere. The oil alert can also fire by date: add
`days: 30` to `oil_change_due` in `alerts.yaml`.

### Clues for unknown codes

`scripts/correlate_mazda_warnings.py` reads a model's database (read-only, after `make ingest`) and lists what
happened together: the warning codes of each event that started a fault read-out and the faults new in that
read-out, every time a warning-lamp flag came on or went off with the warning codes reported in between, and the
dates of the rare warning codes with the flags that were on at the next status report. It prints nothing that
identifies the car.

```bash
cd backend && uv run python ../scripts/correlate_mazda_warnings.py --model cx5
```

`--model` defaults to the default model and `--db` points it at another database file. What it finds are **hints,
not meanings**: two things showing up together does not say what either one is. Keep a hint in the entry's `notes`
(starting with "Hint only", say) and leave `title: null` until you know the meaning from a real source.

### Sharing code descriptions

Mazda does not publish what its warning codes mean, so what you learn is worth sharing with another owner of the
same model. `make codes-export` writes `<model>-codes.yaml` with **only the codes you described**, each with how
you know (add `source: ...` to an entry; otherwise its notes are used). The file holds nothing about your car: no
VIN, no counts, no dates, and the export refuses to write it if a description contains something that looks like one.

To look at a file someone shared with you:

```bash
make codes-import MODEL=cx5 FILE=their-codes.yaml
```

It lists each code as *new* (you have no description), *same* or *differs*, and changes nothing. Take in what you
choose by name, for example `ARGS="--add warnings:\$4E9 ecus:ADU"`, `ARGS=--add-new` (every code you have no
description for) or `ARGS="--replace warnings:\$0F2"` for one that differs from yours. Each entry taken in is marked
`from: <file>` in your description file so you can tell it from your own; then run `make model`. A file made for
another model warns first: a code can mean something else on another car.

### Fault map (optional)

The Faults page can show the car's control units on a plan of the car, lit when the latest read-out lists a fault of
theirs. **You place the units**: Mazda's export says which unit reported a fault, not where the unit is, and the
dashboard never guesses. Until you place one, each unit with faults is listed as "not placed", with the line to add.

Create `config/models/<id>/layout.yaml` with what you know (from a dealer or the workshop manual):

```yaml
units:
  BCM: {zone: dashboard, source: "workshop manual"}        # a zone: engine bay, dashboard, under front seats, rear, roof
  ECM: {at: [0.12, 0.35, 0.4], source: "seen at the dealer"} # or a position: along from the front, across from the left, up
```

Restart the dashboard to see it (no `make ingest` needed); the phone shows it after a new pack.

### Service log (optional)

Keep a note of what was done to the car and the dashboard shows it on the Status page, as marks on the fuel, tire
and oil charts, and on that day's page. On the Mac, press **Add an entry** in the *Service log* panel; or edit the
file yourself, `config/models/<id>/service_log.yaml`, one line per entry:

```yaml
- {date: 2026-09-14, kind: oil_change, note: "Oil and filter at the dealer", odometer_km: 4310}
- {date: 2026-10-02, kind: tires, note: "Winter tires"}
```

`kind` is one of `oil_change`, `tires`, `service`, `software`, `repair`, `other`; `odometer_km` is optional. After
editing the file run `make model` (the form does that part for you), and for the phone make a new pack
(`make mobile-pack`): the phone shows the log but never changes it.

The panel also lists what the data hints at and your log does not have: the oil countdown going up, or a day with a
diagnostic report. These are **suggestions, never entries**: nothing is added unless you add it. Set
`MAZDA_READONLY=1` to switch the form off; the demo is always read-only.

### Adding newer data later

You can keep adding exports as you receive them; history is never lost. There are two ways.

**From the dashboard.** With the dashboard running (`make dev`), open **Import** in the menu and drop Mazda's zip,
or its files, on the page. It checks that they are Mazda's export files and belong to the car on screen, copies
them into that model's data folder, loads them and shows what changed; the Overview then shows a short note of it
until you dismiss it. A car with no data yet shows a link to the same page. Import is not available in the demo or
with `MAZDA_READONLY=1`, and not in the phone app.

**By hand.**

1. Put the new files in `data/cx5/`. Replacing the old files with the new ones is fine, and so is
   keeping both. Only the top level of that folder is read, so moving older exports into
   `data/cx5/archive/` (also git-ignored) keeps them without reloading them.
2. Run `make ingest`. Only rows that are not in the database yet are added. Every row is matched
   by its transaction id or timestamp, so an export that overlaps (or repeats) earlier data
   creates no duplicates, and a cumulative export that starts from the beginning is fine too.
   The output shows how many new rows each file added (`new=0` means nothing new).
3. Open the dashboard (`make dev`). Alerts are re-evaluated; ones you already acknowledged stay
   acknowledged.

A new diagnostic `.txt` file (each download contains one) becomes an additional report on the
Diagnostics page.

Things to know:

- Your history lives in `db/<id>.duckdb`, not in `data/`. **Don't run `make reset-db`** unless
  you mean to start over: it deletes the database, including your acknowledged alerts. Copy
  `db/<id>.duckdb` somewhere safe now and then, and keep your original export files.
- Only new rows are inserted; rows already stored are never updated. If Mazda corrects an old
  value in a later export, the stored value stays. (To rebuild from scratch, run
  `make reset-db` and then `make ingest` with **all** your export files in `data/`.)
- A gap between two exports stays a gap in the charts. The "no new data" alert reminds you
  when it is time to ask for a newer export.

### After updating the code

When you pull a newer version of this project:

```bash
git pull
make setup    # new or changed dependencies
make model    # recreate the SQL views and reload each model's code descriptions and settings (config/models/<id>/)
```

`make model` is needed whenever the views changed (the dashboard says "no such view" or a page is empty
until you run it); your data is not touched. If you use the phone app, run `make mobile-pack` and import
the new pack: some things the app draws travel in the pack (the 3D car's dimensions and shape, for example),
so an older pack can look different from the Mac, and a pack that is too old is refused with a message saying
so. The app itself offers an **Update** button when a new version is published, and the demo cars refresh by
themselves when it updates.

## Use it on your iPhone (offline, with your data on the phone)

The `mobile/` folder is the same dashboard as an offline web app: your data lives **on the phone**
and the app works without the Mac, without Wi-Fi and without any server. The Mac version above is
unaffected. It is read-only: new Mazda exports still go through `make ingest` on the Mac, then a new
data pack goes to the phone.

**Just want to look?** Open <https://ajmcastro.github.io/mazda-data-dashboard/> on your phone (or any
browser) and tap **Load demo data**: that is this project's own published copy of the app, with
synthetic data. To use your own data, publish your own copy as described next (so the address is yours).

**1. Publish the app (once).** The repository has a GitHub Actions workflow that builds the app and
publishes it on GitHub Pages. In your copy of the repository open **Settings → Pages → Build and
deployment → Source: GitHub Actions**, then push to `main` (or run the workflow "Phone app (GitHub
Pages)" from the Actions tab). The address is `https://<your-user>.github.io/<repository>/`.
The site contains the app and the **synthetic demo data only**, never yours.

Any other static host with HTTPS works too (Netlify, Cloudflare Pages, your own server): run
`make mobile-build` and upload the folder `mobile/dist`. It must be `https://`: iOS only installs and
caches an app from a secure address.

**2. Make your data pack** on the Mac:

```bash
make ingest        # if you have new exports (see "Adding newer data later")
make mobile-pack   # writes db/<model>.cx5pack for every model that has data, e.g. db/cx5.cx5pack
```

**3. Move it to the phone.** AirDrop `db/cx5.cx5pack` (and `db/cx60.cx5pack`, one pack per car model) to the iPhone and save it in **Files**
(iCloud Drive is good: it keeps the file as your backup).

**4. Install the app.** Open the site address in **Safari**, tap **Share → Add to Home Screen**, and
open the new "Mazda Data" icon. The first start downloads the app once (about 37 MB). When the **Data**
screen says **Works offline: yes**, you can switch Wi-Fi off.

**5. Import your data.** On the Data screen tap **Import data pack** and choose the file (repeat for each car model: a selector at the top then switches between them). Or try
**Load demo data** first. To update later, make a new pack and use **Add or replace a data pack**
(alerts you acknowledged on the phone stay acknowledged).

Good to know:

- **Privacy.** The pack contains your VIN, so treat it like the raw files. GPS positions are left out.
  The app makes no network request except to its own address, and your data never leaves the phone.
  Keep the pack out of git (`*.cx5pack` is ignored and `make audit` refuses it).
- **iOS may remove the stored data** after a few weeks without use or when space is low. The app asks
  Safari to keep it and tells you if it was removed; importing the pack file again takes seconds.
- **Updates.** When a newer version of the app is published, it shows an **Update** button. The demo data is
  replaced by the new version's at the next start; packs you imported are never touched, so after an update
  that changes what a pack carries, make a new pack of your own data and import it.
- **The car in 3D** is on the Status page (under *More*): numbered pins on the car, the figures listed under
  it, tap a pin or a row for the details. A sideways swipe turns the car; swiping up or down scrolls the page,
  and the + and − buttons zoom. It works offline like everything else. A car's dimensions and shape come from
  its data pack.
- **Units and language.** On the Data screen: pressure, fuel consumption and distance, and English or
  Portuguese, as on the Mac. The choices are per device.
- **What the phone does not have:** the Import page and the service log's *Add an entry* (both write files on
  the Mac). Your fuel log, service log and fault-map placements reach the phone inside a new data pack.
- **Dark or light.** The app follows the iPhone's Appearance setting. The button at the right end of
  the tab bar overrides it: tap to go Auto → Dark → Light. The Mac dashboard has the same switch at the
  bottom of the side menu. The choice is remembered per device.
- **Compare and All cars** (under *More*): the phone holds one car in memory at a time, so the
  first time you open one of them it loads each car once to prepare its figures (a few seconds, with a message), and
  keeps them for next time. Replacing a pack refreshes that car's figures.
- Alerts are not re-evaluated on the phone (they come from `make ingest` on the Mac); you can
  acknowledge them on the phone.
- **Lockdown Mode** (Settings → Privacy & Security) switches off parts of Safari that this app relies on
  (the JavaScript compiler, and it can restrict WebAssembly). If the app is very slow or does not
  start, turn Lockdown Mode off for Safari or for this site. A very old iPhone will also be slow to
  start (a few seconds with real data).
- Android: the app should work in Chrome ("Install app"), but it has not been tested on a device.
- To try the app on the Mac: `make mobile-dev` (installs its packages the first time) and open
  <http://localhost:5174>.

## Alerts

`make ingest` (or `make alerts`) evaluates the rules in each model's `alerts.yaml` (for example [config/models/cx5/alerts.yaml](config/models/cx5/alerts.yaml));
each alert is raised once, and an acknowledged alert is never raised again. The rules:

| Rule | Raises an alert when |
|---|---|
| new fault | a trouble code is reported for the first time |
| recurring fault | a fault is still listed in the latest read-out and has been reported repeatedly |
| low voltage in a freeze frame | a fault's freeze frame recorded a supply voltage below a threshold (12 V): worth a look at the battery, a hint and not a diagnosis |
| new warning code | a warning code appears that was never seen before |
| warning spike | one warning code has an unusually busy day |
| burglar alarm | the alarm status is above normal |
| high consumption | a stretch of driving uses far more fuel than your average |
| low fuel | the latest fuel reading is below a threshold |
| low tire pressure | a tire measurement is below a threshold (check your door-jamb sticker and set it); counted by when the car measured it, so a repeated reading is one alert |
| tire leak forecast (off by default) | a wheel is losing pressure against the other three and reaches your low-pressure limit within `days` (14) at that rate |
| oil change due | the car's own oil-change countdown is at or below 1,000 km (it counts in steps of 1,000 km or more); with `days: 30` also when your recent pace puts the oil change within that many days |
| car warning flag | one of the car's own warning flags (tire pressure per wheel, tire pressure system, oil level, seat belt, door) is on; once per run, severity settable per flag |
| new warning-lamp flag | one of the car's 128 warning-lamp bit flags is set for the first time (almost all never change, so a first set is news) |
| no new data | the newest data is more than a few days old |

Each rule can be switched off and every threshold changed in the file (a typo is reported with a
clear error). Event rules only look at the most recent `lookback_days` of data, so the first run
does not flood you with history. An alert's text is written when the data is loaded, in the data's units
(kPa, km); the dashboard shows it in your language.

For a macOS notification when new alerts appear, set `notifications: desktop: true` in the same
file (or run `cd backend && uv run python -m mazda_dash.alerts --notify`).

## Commands

Run them from the project folder. The first group is what you need to use the dashboard. `MODEL=<id>` limits a command to one car model (see [Car models](#car-models)).

| Command | What it does |
|---|---|
| `make setup` | install backend and frontend dependencies |
| `make demo` | run the dashboard on the synthetic sample data (`make demo-ingest` only loads it) |
| `make ingest` | load `data/<id>/` into `db/<id>.duckdb`, rebuild the views, evaluate alerts |
| `make dev` | run API and dashboard (`make api` / `make web` for just one of them) |
| `make model` | reload each model's configuration (`codes/*.yaml`, `settings.yaml`, the fuel and service logs) and recreate the SQL views |
| `make unmapped` | list codes and flags in your data that have no description |
| `make timezone` | check `car_timezone` in `config/models/<id>/settings.yaml` against your data |
| `make alerts` | evaluate `config/models/<id>/alerts.yaml` only |
| `make models`, `make migrate-models` | show the car models and where their files are; move a single-car install into the model folders |
| `make compat` | per model: which signals the dashboard reads are missing from your data, and which of your signals nothing reads yet |
| `make codes-export` / `make codes-import` | share the codes you described, or look at a file another owner shared (see [Sharing code descriptions](#sharing-code-descriptions)) |
| `make mobile-pack` | export each model's database as `db/<model>.cx5pack` for the phone app |
| `make mobile-dev` | run the phone app on this computer (with the demo data bundled) |
| `make audit` | check for private values before publishing (see [Privacy](#privacy)) |
| `make reset-db` | **delete** `db/<id>.duckdb`, including acknowledged alerts (with several models, name one: `MODEL=<id>`) |

For development (see [Development](#development)):

| Command | What it does |
|---|---|
| `make test` / `make lint` / `make format` | backend and frontend tests / checks / backend formatting |
| `make types` | regenerate the frontend's TypeScript types from the API schema |
| `make sample-data` | regenerate `sample_data/<model>/` for every model (deterministic) |
| `make mobile-test` | check that the phone app's TypeScript engine answers exactly like the Python API |
| `make mobile-golden`, `make mobile-golden-real` | record the Python API's answers for those tests (on the sample data / on your own database) |
| `make mobile-install`, `make mobile-typecheck`, `make mobile-build`, `make mobile-demo-pack` | the phone app's packages, type check, production build, demo data pack |
| `make screenshots` | retake the README screenshots from the demo data (needs Google Chrome) |
| `make profile` | per-file data profiling reports in `docs/profile/` |
| `make clean` | remove generated profiling reports and tool caches |

## How it works

```
data/<id>/*.csv, *.txt ──ingest──▶ DuckDB tables ──views + your code descriptions──▶ FastAPI ──▶ React dashboard
                                   │   ▲        (config/models/<id>/codes, settings.yaml)
                                   │   └──alert rules (config/models/<id>/alerts.yaml)
                                   │
                  make mobile-pack ▼
                          data pack ──AirDrop──▶ iPhone: DuckDB in the browser ──▶ the same React pages
                                                 (a TypeScript copy of the API, kept identical by tests)
```

- `backend/src/mazda_dash/ingest`: parsers for each file kind (idempotent; sentinel values such
  as `2147483647` become NULL).
- `backend/src/mazda_dash/models.py`: the car-model registry (where each model's data, database and configuration are).
- `backend/src/mazda_dash/model`: lookup tables from `config/models/<id>/codes/`, the settings (fuel prices, your
  fuel and service logs) and the SQL views the API and alerts read ([view catalogue](docs/data-dictionary.md)).
- `backend/src/mazda_dash/alerts`: one detector per rule; each alert is raised once.
- `backend/src/mazda_dash/api`: the JSON API. It only reads, with three exceptions that never leave your machine:
  acknowledging an alert, adding a service-log entry, and importing a download (`importer.py`).
- `backend/src/mazda_dash/tires.py`, `forecast.py`: the tire leak and the looking-ahead estimates, shared by the
  API and the alert rules. `codepack.py`: sharing code descriptions. `pack.py`: the phone's data pack.
- `frontend/`: Vite, React, TypeScript, Recharts. Types are generated from the API's OpenAPI
  schema. The wording of every sentence the pages show lives in small tested modules next to the pages, and
  `frontend/src/i18n/` holds the two languages. The 3D car (`frontend/src/car3d/`) is drawn with three.js, loaded
  only when the view is shown; each car's shape is a small file of numbers in `car3d/shapes/` (no model files, no
  textures).
- `mobile/`: the same pages as an offline phone app. DuckDB runs in the browser (WebAssembly) on a
  data pack exported by `make mobile-pack`, and a TypeScript port of the API answers the pages;
  contract tests keep it identical to the Python API. See [mobile/README.md](mobile/README.md).
- `config/`: `models.yaml` (the list of car models) and, per model in `config/models/<id>/`, what is yours:
  `model.yaml`, your settings (`settings.yaml`), the alert rules (`alerts.yaml`), your descriptions of codes and
  flags (`codes/*.yaml`) and, if you keep them, `fuel_log.yaml`, `service_log.yaml` and `layout.yaml`.
  `sample_data/`: the synthetic exports (and demo settings), one folder per model. `docs/`: the data dictionary
  and screenshots. `data/` and `db/` (git-ignored) hold your files and databases.

[PLAN.md](PLAN.md) has the design decisions and the milestones this was built in.

## Limitations

- **One car per model.** A model's folder and database hold one vehicle; several cars of the same model (two
  VINs in one folder) are not separated (`make ingest` warns). Cars of different models are fine.
- **Mazda does not publish the meaning of most codes.** Warning codes (`$XXX`), many fault details, the
  alarm codes and the 128 warning-lamp flags are shown as they are; you add descriptions yourself in
  `config/models/<id>/codes/`. Several signal interpretations (fuel, oil, tire time) are inferred from the data, see the
  [data dictionary](docs/data-dictionary.md). Treat this as a curiosity tool, not diagnostics.
- **The export is a snapshot.** The data comes in files you request (see above); there is no live feed.
  Gaps between exports stay gaps.
- **The 3D car is a schematic.** Its shape is drawn in code: a likeness for the CX-5 (2026 generation) and the
  CX-60, a generic SUV for any other model, and never the real body. It shows what the status reports say
  (tires, doors, trunk, hood, fuel, oil countdown, odometer). Mazda does not publish where the control units
  sit, so the [fault map](#fault-map-optional) shows only the units you place yourself. The dimensions in
  `model.yaml` were looked up, not taken from a manual.
- **The fuel cost is an estimate.** The litres the car reports times the price you enter: not what you paid, and nothing for electricity.
- **Forecasts are your recent pace carried forward.** The oil-change dates, the year's distance and a tire reaching
  its limit say "at this rate", are counted from your newest data, and change as you drive more or less.
- **A fill-up and a drive are known only as "between two status reports".** The car reports its state now and
  then, not each trip, so times and litres are approximate and say so.
- **The phone app is a read-only viewer.** It does not read Mazda's files, evaluate alerts, import a download or
  add to the service log; the Mac does that and sends a data pack. iOS may delete stored web-app data (you
  re-import the pack).
- **Two languages.** English and Portuguese (Portugal). Alert texts are stored in English and worded again on
  screen; your own descriptions and notes are never translated.
- Tested with one real export (a CX-5, Europe, 2026) plus the synthetic data (which includes a second,
  deliberately different model). Other models, markets or firmware may differ (`make compat` shows what); issues and sample files without personal data are welcome.

## Privacy

Vehicle exports contain your VIN, and may contain GPS positions. `data/`, `db/` and `*.duckdb`
are git-ignored, and nothing you load is sent anywhere: the dashboard talks only to the API on
your own machine. The fonts are bundled, so neither the dashboard nor the phone app makes any request
to an outside host. Data packs (`*.cx5pack`, which hold the VIN) are
git-ignored too.

The published phone app (GitHub Pages) is static code plus the synthetic demo data: it never receives
your data, which you import from your own phone's storage.

The things that write or produce a file all stay on your machine: the **Import** page sends Mazda's download to
the API on your own computer, which stores it in `data/<id>/`; the **calendar file** is made in the page; the
**report** is printed by your browser and leaves the VIN out unless you tick it; and `make codes-export` writes
only descriptions, never a VIN, a count or a date (the file it writes, `<model>-codes.yaml`, is git-ignored).

The two car shapes of the 3D view were traced by hand from the owner's photos of the cars. No photo is in the
repository, and nothing was read from a number plate: only the outline, as fractions of the car's length and
height.

If you fork this project, or publish your own copy, run:

```bash
make audit
```

It reads the private values (VINs, positions) from every model's folder in `data/` and searches every file
git would publish **and the whole git history** for them, checks that the synthetic data in `sample_data/` holds
only made-up VINs, and lists the commit author emails for review. The tests and the sample data use only made-up values. **When you report a problem, do not
post your VIN, your export files or a data pack**: describe the problem, or reproduce it with the demo
data.

## Troubleshooting

- **"Database … not found - run `make ingest` first"**: you have not loaded any data yet. Put
  your files in `data/<id>/` and run `make ingest`, or try `make demo`.
- **"Database is busy" when acknowledging an alert**: `make ingest` is running and holds the
  database; wait for it to finish.
- **Charts are empty or say "No data in this period"**: look at the period bar and press
  **All time**.
- **The model selector does not show my second car**: it lists only models that have data. Put the car's exports
  in `data/<id>/` and run `make ingest MODEL=<id>`. (The address `?model=<id>` shows where to put the files.)
- **The cost figures are missing**: no fuel price is set for that car; see [Fuel cost](#fuel-cost-optional).
- **Fill-ups show "points" instead of litres**: `tank_litres` is not set for that car; see [Fill-ups](#fill-ups-optional).
- **There is no Import entry in the menu, or no "Add an entry" in the service log**: the server is read-only.
  That is always so in the demo and in the phone app, and with `MAZDA_READONLY=1`; use `make dev` on your own data.
- **The dashboard is in the wrong language**: the language menu is on *Auto*, which follows your browser. Pick
  *English* or *Português* (under the units at the bottom of the menu; on the phone, *More → Data on this phone*).
- **The fault map lists every unit as "not placed"**: nothing is placed until you say where a unit is; see
  [Fault map](#fault-map-optional).
- **Port 8000 or 5173 already in use**: stop the other program using it, then run `make dev`
  again.
- **`npm install` fails**: use `make setup`; `frontend/.npmrc` sets the option this project's
  dependencies need.
- **A page is empty or an error mentions a missing view or table after updating**: run `make model`
  (see [After updating the code](#after-updating-the-code)).
- **Tire measurement times look wrong** (in the future, or hours old): the time zone in
  `config/models/<id>/settings.yaml` does not match your car; run `make timezone`.
- **The Status page shows a list instead of the 3D car**: the browser could not draw it (WebGL is switched
  off or not available; on an iPhone, Lockdown Mode can do that). The list holds the same figures. The
  *3D | List* switch tries again, and it also remembers when you chose the list yourself.
- **The 3D car has the wrong proportions, or the driver's door is on the wrong side**: set the car's
  dimensions and `steering` under `body:` in `config/models/<id>/model.yaml` (see
  [How to add a model](#how-to-add-a-model)); for the phone, make a new pack afterwards.
- **After an update the phone app looks different from the Mac for your own car** (for example the 3D car has
  the generic shape): what is drawn can depend on the data pack, and the pack on the phone was made before the
  change. Run `make mobile-pack` and import the new pack. The demo cars refresh by themselves when the app
  updates.
- **The phone app says a data pack is from an older version**: run `make mobile-pack` again and import the
  new file.
- **`make screenshots` or `make mobile-dev` says a port is in use**: stop `make dev` (ports 8000, 5173,
  5174) first.

## Development

```bash
make test          # pytest + vitest
make lint          # ruff, oxlint, tsc
make mobile-test   # phone app: contract tests against the Python API, types
```

CI (GitHub Actions) runs the same checks plus a format check and production builds, verifies that the
generated types and sample data are up to date, replays the Python API's answers against the phone app's
engine, and runs the privacy audit. The phone app is published by `.github/workflows/pages.yml`.
When you change an API endpoint, change its twin in `mobile/src/engine/` in the same commit. Text a reader sees
goes through the translation functions and needs its Portuguese (a test fails otherwise).

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). [CLAUDE.md](CLAUDE.md) is a tour of the
code (written for coding assistants, useful for people too).

## About this project

Designed and directed by Antonio Castro, and built together with [Claude Code](https://claude.com/claude-code)
(Anthropic's AI coding assistant): milestone by milestone, from a plan written first to code, tests and
documentation, with every step reviewed and run on the owner's own car data. The commits carry
`Co-Authored-By: Claude`, and [CLAUDE.md](CLAUDE.md) is the guide the assistant works from. The results are
checked by tests that do not depend on the assistant: the contract tests between the two API
implementations, the privacy audit, and CI. Not affiliated with Mazda or Anthropic.

## License

[MIT](LICENSE)
