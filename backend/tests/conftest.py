"""Synthetic fixtures in the same format as the Mazda exports (no real data)."""

import pytest

VIN = "TESTVIN0000000001"

WAR = f'''"X_TRANSACTION_ID","VIN","COPIED_DT_TM","WARNING_TRIGGER_OCCURRENCE_TM","HOURS","MINUTES","ODO_INFORMATION_KM","WARNING_LIST"
"tx-w1","{VIN}","2026-06-13 09:51:35","2026-06-13T08:45:48Z","1","0","59","$182,$21D,$210"
"tx-w2","{VIN}","2026-06-13 10:36:07","2026-06-13T09:23:57Z","2147483647","2147483647","-1","$210"
"tx-w2","{VIN}","2026-06-13 10:36:07","2026-06-13T09:23:57Z","2147483647","2147483647","-1","$210"
'''

DTC_H = f'''"X_TRANSACTION_ID","VIN","COPIED_DT_TM","DIAGNOSTICS_ACQUISITION_TM","WARNING_TRIGGER_OCCURRENCE_TM","HOURS","MINUTES","ODO_INFORMATION_KM"
"tx-d1","{VIN}","2026-06-13 09:51:40","","2026-06-13T08:45:48Z","1","0","59"
'''

DTC_D = f'''"X_TRANSACTION_ID","VIN","COPIED_DT_TM","STATUS_CODE","ECU_NAME_MKT","DISPLAY_DTC","DISPLAY_STATUS","DTC_STATUS_FLAG"
"tx-d1","{VIN}","2026-06-13 09:51:40","1","BCM","","","0"
"tx-d1","{VIN}","2026-06-13 09:51:40","1","ADU","C1681:13","28","3"
"tx-d1","{VIN}","2026-06-13 09:51:40","4","DCM","19 02 8F","","4"
'''

DTC_SSR = f'''"X_TRANSACTION_ID","VIN","COPIED_DT_TM","DIAGNOSTICS_ACQUISITION_TM","WARNING_TRIGGER_OCCURRENCE_TM","HOURS","MINUTES","ODO_INFORMATION_KM","ECU_NAME_MKT","STATUS_CODE","DISPLAY_DTC","DISPLAY_STATUS","DTC_STATUS_FLAG","DTC_SNAPSHOT_RECORD_NUMBER","Time_UTC_Information_Year","Time_UTC_Information_Month","Time_UTC_Information_Date","Time_UTC_Information_Hour","Time_UTC_Information_Minute","Time_UTC_Information_Second","Vehicle_Speed","Empty_Signal"
"tx-s1","{VIN}","2026-06-13 10:36:11","","2026-06-13T09:23:57Z","1","0","59","ADU","1","C1A0F:87","28","3","22","2026","6","9","14","34","17","12.5",""
'''

RTS = f'''"vin","fileid_datetime","requesttype","isinservicemode","datacreationtime","ododispvalue_value","ododispvalue_validstatus","enginestate_value","enginestate_validstatus","latitude","longitude"
"{VIN}","2026-06-12 23:03:57","RemoteConfirm","false","2026-06-12T23:04:08Z","59.1","Valid","3","Invalid","41.1","-8.6"
'''

ALT = f'''"vin","fileid_datetime","datacreationtime","burglarstatus_value","burglarstatus_validstatus"
"{VIN}","2026-08-16 08:40:45","2026-08-16T08:46:02Z","5","Valid"
'''

DIAG = """Collect Diagnostic Information

Date:2026/10/15
Time:09:56:59
TimeZone:UTC+0100


ODO:5781km

Mode 9
ModuleName:ECM
VIN   TESTVIN0000000001
CALID   ABC123
IPT
   (IGNCNTR) = 278
VOD - Engine Run/Idle Time
   (ERT_R) = 42327 s
   (OCCT1_TIME1_R) = 4294967295 s
AES ID and Status
   (AESIDx) = 1814
   (AESIDx_Activity_State) = Not Active
   (AESIDx) = 181A
   (AESIDx_Activity_State) = Not Active
Mode 9 Workaround



dtcs
ModuleName:ADU
C1C83:00-28
Rob_dtcs
ModuleName:DCM
XB2A92:00-28

SnapshotData
ModuleName:ADU
DTC:C1C83:00-28
RecordNumber:01
APP:15.5 %
POWER_MODE:ON
Mode 6
ModuleName:ECM
OBDMID: 2, Test: 3, Min: 300.171 mV, Max: 310.000 mV, Value: 300.171 mV
OBDMID: A2, Test: B, Min: 0, Max: 65535, Value: 1
"""


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    files = {
        "all-war-24pf_war-24pf.csv": WAR,
        "all-dtc-h-24pf_dtc-h-24pf.csv": DTC_H,
        "all-dtc-d-24pf_dtc-d-24pf.csv": DTC_D,
        "all-dtc-ssr-24pf_dtc-ssr-24pf.csv": DTC_SSR,
        "all-rts-24pf_rts-24pf.csv": RTS,
        "all-alt-24pf_alt-24pf.csv": ALT,
        "all-24pf-diag-tool_24pf-diag-tool_1_20261015_090243.txt": DIAG,
    }
    for name, content in files.items():
        (d / name).write_text(content)
    return d
