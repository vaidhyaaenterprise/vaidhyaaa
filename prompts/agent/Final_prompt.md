1) Retry logic for llm
2) Retry logic for stt and tts models
3) if retry failed fallback to user like server is not working, kindly call after sometime and create callback request to staff and tell that it is not working now
4) Retry logic for db queries and any application related issue
5) Retry logic for background job failure case
6) Call time should be limited, if no response for more than sometime, tell the patient and cut the call
7) Need to see whether any keyword is used in booking or any flow, it should not depend on any keyword.
8) Need to verify other clinics data is taken or not
9) Call recording storage setup and cleanup job for that
10) How to retreive the call recording storage and retrieve the call info from that