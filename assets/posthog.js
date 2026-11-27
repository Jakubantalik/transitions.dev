// PostHog web analytics (EU project shared with dona.ai and libraries.dev): page views and page
// leaves only. No cookies (memory persistence), no autocapture, no dead clicks, no surveys, no web
// vitals, no session recordings. The project token is write-only and safe in public code.
// Loader: PostHog's own HTML snippet, unchanged.
!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="Hh Wh Vh Gh Zh Xh init Ad Rd $d Td Ld Oc Ed Dd kd Hd Ud Wd Vd Gd Jd capture getExtension Pd Rr Md Id calculateEventProperties Zd Kd register register_once register_for_session unregister unregister_for_session iv xd Xd getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys onActiveMatchingSurveysChanged renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync nv identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset sv shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty tv qd createPersonProfile setInternalOrTestUser ev rd nd opt_in_capturing opt_out_capturing sd has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Nd debug Fc Ds getPageViewId captureTraceFeedback captureTraceMetric bd".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  posthog.init('phc_nTuun97AmEBxiDFHH8ivrpUwXQLhB92XssquVVF9XmbF', {
    api_host: 'https://eu.i.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    persistence: 'memory',
    autocapture: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    capture_performance: false,
    disable_session_recording: true,
    capture_pageview: true,
    capture_pageleave: true,
  })
}
